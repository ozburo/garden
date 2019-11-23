/*
 * Copyright (C) 2018 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { ConfigGraph } from "../../config-graph"
import { Command, CommandResult, CommandParams, StringParameter } from "../base"
import { printHeader } from "../../logger/util"
import { getTaskVersion } from "../../tasks/task"
import { RunTaskResult } from "../../types/plugin/task/runTask"
import chalk from "chalk"
import { getArtifactFileList, getArtifactKey } from "../../util/artifacts"

const getTaskResultArgs = {
  name: new StringParameter({
    help: "The name of the task",
    required: true,
  }),
}

type Args = typeof getTaskResultArgs

interface Result extends RunTaskResult {
  artifacts: string[]
}

export type GetTaskResultCommandResult = Result | null

export class GetTaskResultCommand extends Command<Args> {
  name = "task-result"
  help = "Outputs the latest execution result of a provided task."

  arguments = getTaskResultArgs

  async action({
    garden,
    log,
    headerLog,
    args,
  }: CommandParams<Args>): Promise<CommandResult<GetTaskResultCommandResult>> {
    const taskName = args.name

    const graph: ConfigGraph = await garden.getConfigGraph(log)
    const task = await graph.getTask(taskName)

    const actions = await garden.getActionRouter()

    const taskResult = await actions.getTaskResult({
      log,
      task,
      taskVersion: await getTaskVersion(garden, graph, task),
    })

    let result: GetTaskResultCommandResult = null

    if (taskResult) {
      const artifacts = await getArtifactFileList({
        key: getArtifactKey("task", task.name, task.module.version.versionString),
        artifactsPath: garden.artifactsPath,
        log: garden.log,
      })
      result = {
        ...taskResult,
        artifacts,
      }
    }

    printHeader(headerLog, `Task result for task ${chalk.cyan(taskName)}`, "rocket")

    if (result === null) {
      log.info(`Could not find results for task '${taskName}'`)
    } else {
      log.info({ data: result })
    }

    return { result }
  }
}
