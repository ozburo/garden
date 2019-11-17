/*
 * Copyright (C) 2018 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import Bluebird from "bluebird"
import { join, relative } from "path"
import { pathExists, readFile } from "fs-extra"
import { createGardenPlugin } from "../../types/plugin/plugin"
import { providerConfigBaseSchema, ProviderConfig, Provider } from "../../config/provider"
import { joi } from "../../config/common"
import { dedent, splitLines } from "../../util/string"
import { TestModuleParams } from "../../types/plugin/module/testModule"
import { Module } from "../../types/module"
import { BinaryCmd } from "../../util/ext-tools"
import { STATIC_DIR } from "../../constants"
import { padStart, padEnd } from "lodash"
import chalk from "chalk"
import { ConfigurationError } from "../../exceptions"
import { containerHelpers } from "../container/helpers"
import { baseBuildSpecSchema } from "../../config/module"

const defaultConfigPath = join(STATIC_DIR, "hadolint", "default.hadolint.yaml")
const configFilename = ".hadolint.yaml"

interface HadolintProviderConfig extends ProviderConfig {
  autoInject: boolean
  testFailureThreshold: "error" | "warning" | "none"
}

interface HadolintProvider extends Provider<HadolintProviderConfig> {}

const configSchema = providerConfigBaseSchema
  .keys({
    autoInject: joi
      .boolean()
      .default(true)
      .description(
        dedent`
          By default, the provider automatically creates a \`hadolint\` module for every \`container\` module in your
          project. Set this to \`false\` to disable this behavior.
        `
      ),
    testFailureThreshold: joi
      .string()
      .allow("error", "warning", "none")
      .default("error")
      .description(
        dedent`
          Set this to \`"warning"\` if you'd like tests to be marked as failed if one or more warnings are returned.
          Set to \`"none"\` to always mark the tests as successful.
        `
      ),
  })
  .unknown(false)

interface HadolintModuleSpec {
  dockerfilePath: string
}

type HadolintModule = Module<HadolintModuleSpec>

export const gardenPlugin = createGardenPlugin({
  name: "hadolint",
  dependencies: ["container"],
  configSchema,
  handlers: {
    augmentGraph: async ({ ctx, modules }) => {
      const provider = ctx.provider as HadolintProvider

      if (!provider.config.autoInject) {
        return {}
      }

      return {
        addModules: await Bluebird.filter(modules, async (module) => {
          return module.compatibleTypes.includes("container") && (await containerHelpers.hasDockerfile(module))
        }).map((module) => {
          return {
            kind: "Module",
            type: "hadolint",
            name: "hadolint-" + module.name,
            description: `hadolint test for module '${module.name}' (auto-generated)`,
            path: module.path,
            dockerfilePath: relative(module.path, containerHelpers.getDockerfileSourcePath(module)),
          }
        }),
      }
    },
  },
  createModuleTypes: [
    {
      name: "hadolint",
      docs: dedent`
        Runs \`hadolint\` on the specified Dockerfile.

        > Note: In most cases, you'll let the provider create this module type automatically, but you may in some cases want or need to manually specify a Dockerfile to lint.

        To configure \`hadolint\`, you can use \`.hadolint.yaml\` config files. For each test, we first look for one in
        the module root. If none is found there, we check the project root, and if none is there we fall back to default
        configuration. Note that for reasons of portability, we do not fall back to global/user configuration files.

        See the [hadolint docs](https://github.com/hadolint/hadolint#configure) for details on how to configure it.
      `,
      schema: joi.object().keys({
        build: baseBuildSpecSchema,
        dockerfilePath: joi
          .string()
          .posixPath({ relativeOnly: true, subPathOnly: true })
          .required()
          .description("POSIX-style path to a Dockerfile that you want to lint with `hadolint`."),
      }),
      handlers: {
        configure: async ({ moduleConfig }) => {
          moduleConfig.include = [moduleConfig.spec.dockerfilePath]
          moduleConfig.testConfigs = [{ name: "lint", dependencies: [], spec: {}, timeout: 10 }]
          return { moduleConfig }
        },
        testModule: async ({ ctx, log, module, testConfig }: TestModuleParams<HadolintModule>) => {
          const dockerfilePath = join(module.path, module.spec.dockerfilePath)
          const startedAt = new Date()
          let dockerfile: string

          try {
            dockerfile = (await readFile(dockerfilePath)).toString()
          } catch {
            throw new ConfigurationError(`hadolint: Could not find Dockerfile at ${module.spec.dockerfilePath}`, {
              modulePath: module.path,
              ...module.spec,
            })
          }

          let configPath: string
          const moduleConfigPath = join(module.path, configFilename)
          const projectConfigPath = join(ctx.projectRoot, configFilename)

          if (await pathExists(moduleConfigPath)) {
            // Prefer configuration from the module root
            configPath = moduleConfigPath
          } else if (await pathExists(projectConfigPath)) {
            // 2nd preference is configuration in project root
            configPath = projectConfigPath
          } else {
            // Fall back to empty default config
            configPath = defaultConfigPath
          }

          const args = ["--config", configPath, "--format", "json", dockerfilePath]
          const result = await hadolint.exec({ log, args, ignoreError: true })

          let success = true

          const parsed = JSON.parse(result.stdout)
          const errors = parsed.filter((p: any) => p.level === "error")
          const warnings = parsed.filter((p: any) => p.level === "warning")
          const provider = ctx.provider as HadolintProvider
          const threshold = provider.config.testFailureThreshold

          if (warnings.length > 0 && threshold === "warning") {
            success = false
          } else if (errors.length > 0 && threshold !== "none") {
            success = false
          }

          let formattedResult = "OK"

          if (parsed.length > 0) {
            const dockerfileLines = splitLines(dockerfile)

            formattedResult =
              `hadolint reported ${errors.length} error(s) and ${warnings.length} warning(s):\n\n` +
              parsed
                .map((msg: any) => {
                  const color = msg.level === "error" ? chalk.bold.red : chalk.bold.yellow
                  const rawLine = dockerfileLines[msg.line - 1]
                  const linePrefix = padEnd(`${msg.line}:`, 5, " ")
                  const columnCursorPosition = (msg.column || 1) + linePrefix.length

                  return dedent`
                    ${color(msg.code + ":")} ${chalk.bold(msg.message || "")}
                    ${linePrefix}${chalk.gray(rawLine)}
                    ${chalk.gray(padStart("^", columnCursorPosition, "-"))}
                  `
                })
                .join("\n")
          }

          return {
            testName: testConfig.name,
            moduleName: module.name,
            command: ["hadolint", ...args],
            version: module.version.versionString,
            success,
            startedAt,
            completedAt: new Date(),
            log: formattedResult,
          }
        },
      },
    },
  ],
})

const hadolint = new BinaryCmd({
  name: "hadolint",
  specs: {
    darwin: {
      url: "https://github.com/hadolint/hadolint/releases/download/v1.17.2/hadolint-Darwin-x86_64",
      sha256: "da3bd1fae47f1ba4c4bca6a86d2c70bdbd6705308bd300d1f897c162bc32189a",
    },
    linux: {
      url: "https://github.com/hadolint/hadolint/releases/download/v1.17.2/hadolint-Linux-x86_64",
      sha256: "b23e4d0e8964774cc0f4dd7ff81f1d05b5d7538b0b80dae5235b1239ab60749d",
    },
    win32: {
      url: "https://github.com/hadolint/hadolint/releases/download/v1.17.2/hadolint-Windows-x86_64.exe",
      sha256: "8ba81d1fe79b91afb7ee16ac4e9fc6635646c2f770071d1ba924a8d26debe298",
    },
  },
})
