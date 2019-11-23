/*
 * Copyright (C) 2018 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import Bluebird from "bluebird"
import chalk from "chalk"
import pluralize = require("pluralize")
import { Module, getModuleKey } from "../types/module"
import { BuildResult } from "../types/plugin/module/build"
import { BaseTask, TaskType } from "../tasks/base"
import { Garden } from "../garden"
import { LogEntry } from "../logger/log-entry"
import { some } from "lodash"

export interface BuildTaskParams {
  garden: Garden
  log: LogEntry
  module: Module
  force: boolean
  fromWatch?: boolean
  hotReloadServiceNames?: string[]
}

export class BuildTask extends BaseTask {
  type: TaskType = "build"

  private module: Module
  private fromWatch: boolean
  private hotReloadServiceNames: string[]

  constructor({ garden, log, module, force, fromWatch = false, hotReloadServiceNames = [] }: BuildTaskParams) {
    super({ garden, log, force, version: module.version })
    this.module = module
    this.fromWatch = fromWatch
    this.hotReloadServiceNames = hotReloadServiceNames
  }

  async getDependencies() {
    const dg = await this.garden.getConfigGraph(this.log)
    const deps = (await dg.getDependencies("build", this.getName(), false)).build

    return Bluebird.map(deps, async (m: Module) => {
      return new BuildTask({
        garden: this.garden,
        log: this.log,
        module: m,
        force: this.force,
        fromWatch: this.fromWatch,
        hotReloadServiceNames: this.hotReloadServiceNames,
      })
    })
  }

  getName() {
    return getModuleKey(this.module.name, this.module.plugin)
  }

  getDescription() {
    return `building ${this.getName()}`
  }

  async process(): Promise<BuildResult> {
    const module = this.module
    const actions = await this.garden.getActionRouter()

    const log = this.log.info({
      section: this.getName(),
      msg: `Preparing build (${pluralize("file", module.version.files.length, true)})...`,
      status: "active",
    })

    const logSuccess = () => {
      log.setSuccess({
        msg: chalk.green(`Done (took ${log.getDuration(1)} sec)`),
        append: true,
      })
    }

    const graph = await this.garden.getConfigGraph(log)
    await this.garden.buildDir.syncFromSrc(this.module, log)
    await this.garden.buildDir.syncDependencyProducts(this.module, graph, log)

    if (!this.force) {
      log.setState({
        msg: `Getting build status for ${module.version.versionString}...`,
      })
      const status = await actions.getBuildStatus({ log: this.log, module })

      if (status.ready) {
        logSuccess()
        return { fresh: false }
      }
    }

    log.setState({ msg: `Building version ${module.version.versionString}...` })

    let result: BuildResult
    try {
      result = await actions.build({
        module,
        log,
      })
    } catch (err) {
      log.setError()
      throw err
    }

    logSuccess()
    return result
  }
}

/**
 * Use this method to get the build tasks for a module. This is needed to be able to avoid an unnecessary build step
 * when there is no build handler and no dependency files to copy.
 */
export async function getBuildTasks(params: BuildTaskParams): Promise<BuildTask[]> {
  // We need to see if a build step is necessary for the module. If it is, return a build task for the module.
  // Otherwise, return a build task for each of the module's dependencies.
  // We do this to avoid displaying no-op build steps in the stack graph.

  const { garden, module } = params

  // We need to build if there is a copy statement on any of the build dependencies.
  let needsBuild = some(module.build.dependencies, (d) => d.copy && d.copy.length > 0)

  if (!needsBuild) {
    // We also need to build if there is a build handler for the module type
    const actions = await garden.getActionRouter()
    try {
      await actions.getModuleActionHandler({
        actionType: "build",
        moduleType: module.type,
      })

      needsBuild = true
    } catch {
      // No build handler for the module type.
    }
  }

  const buildTask = new BuildTask(params)

  if (needsBuild) {
    return [buildTask]
  } else {
    return buildTask.getDependencies()
  }
}
