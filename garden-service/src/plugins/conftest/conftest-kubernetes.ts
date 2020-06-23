/*
 * Copyright (C) 2018-2020 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import Bluebird from "bluebird"
import slash from "slash"
import { createGardenPlugin } from "../../types/plugin/plugin"
import { ConftestProvider } from "./conftest"
import { relative, resolve } from "path"
import { dedent } from "../../util/string"
import { getModuleTypeUrl, getGitHubUrl } from "../../docs/common"
import { collectTemplateReferences } from "../../template-string"
import { uniq } from "lodash"

const moduleTypeUrl = getModuleTypeUrl("conftest")
const gitHubUrl = getGitHubUrl("examples/conftest")

/**
 * Auto-generates a conftest module for each helm and kubernetes module in your project
 */
export const gardenPlugin = createGardenPlugin({
  name: "conftest-kubernetes",
  base: "conftest",
  dependencies: ["kubernetes"],
  docs: dedent`
    This provider automatically generates [conftest modules](${moduleTypeUrl}) for \`kubernetes\` and
    \`helm\` modules in your project. A \`conftest\` module is created for each of those module types.

    Simply add this provider to your project configuration, and configure your policies. Check out the below
    reference for how to configure default policies, default namespaces, and test failure thresholds for the generated
    modules.

    See the [conftest example project](${gitHubUrl}) for a simple
    usage example.
  `,
  handlers: {
    augmentGraph: async ({ ctx, modules }) => {
      const provider = ctx.provider as ConftestProvider

      const allModuleNames = new Set(modules.map((m) => m.name))

      return {
        addModules: await Bluebird.filter(modules, async (module) => {
          return (
            // Pick all kubernetes or helm modules
            module.compatibleTypes.includes("helm") || module.compatibleTypes.includes("kubernetes")
          )
        }).map((module) => {
          const baseName = "conftest-" + module.name

          let name = baseName
          let i = 2

          while (allModuleNames.has(name)) {
            name = `${baseName}-${i++}`
          }

          allModuleNames.add(name)

          // Make sure the policy path is valid POSIX on Windows
          const policyPath = slash(relative(module.path, resolve(ctx.projectRoot, provider.config.policyPath)))

          const isHelmModule = module.compatibleTypes.includes("helm")

          if (isHelmModule) {
            // Add any services/tasks referenced in runtime template strings as runtime dependencies
            // TODO: make some reusable helpers for this type of thing
            const runtimeDependencies = uniq(
              collectTemplateReferences(module.spec)
                .filter((ref) => ref[0] === "runtime" && ref[2])
                .map((ref) => ref[2])
            )

            return {
              kind: "Module",
              type: "conftest-helm",
              name,
              description: `conftest test for module '${module.name}' (auto-generated by conftest-kubernetes)`,
              path: module.path,
              sourceModule: module.name,
              policyPath,
              namespace: provider.config.namespace,
              combine: false,
              runtimeDependencies,
            }
          } else {
            return {
              kind: "Module",
              type: "conftest",
              name,
              description: `conftest test for module '${module.name}' (auto-generated by conftest-kubernetes)`,
              path: module.path,
              sourceModule: module.name,
              policyPath,
              namespace: provider.config.namespace,
              combine: false,
              files: module.include || ["*.yaml", "**/*.yaml", "*.yml", "**/*.yml"],
            }
          }
        }),
      }
    },
  },
})
