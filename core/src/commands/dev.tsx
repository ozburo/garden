/*
 * Copyright (C) 2018-2023 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { CommandResult, CommandParams, ConsoleCommand } from "./base"
import { renderDivider } from "../logger/util"
import React, { FC, useState } from "react"
import { Box, render, Text, useInput, useStdout } from "ink"
import { serveArgs, ServeCommand, serveOpts } from "./serve"
import { LoggerType } from "../logger/logger"
import { ParameterError } from "../exceptions"
import { InkTerminalWriter } from "../logger/writers/ink-terminal-writer"
import { CommandLine } from "../cli/command-line"
import chalk from "chalk"
import { globalOptions, StringsParameter } from "../cli/params"
import { pick } from "lodash"
import Divider from "ink-divider"
import moment from "moment"
import { dedent } from "../util/string"
import Spinner from "ink-spinner"
import type { Log } from "../logger/log-entry"

const devCommandArgs = {
  ...serveArgs,
}
const devCommandOpts = {
  ...serveOpts,
  cmd: new StringsParameter({
    help: dedent`
      Specify a command to run in the console after startup. You may specify multiple commands and they will be run in succession.
    `,
  }),
}

type DevCommandArgs = typeof devCommandArgs
type DevCommandOpts = typeof devCommandOpts
type ActionParams = CommandParams<DevCommandArgs, DevCommandOpts>

export class DevCommand extends ServeCommand<DevCommandArgs, DevCommandOpts> {
  name = "dev"
  help = "Starts the Garden interactive development console."

  protected = true
  cliOnly = true
  streamEvents = true

  arguments = devCommandArgs
  options = devCommandOpts

  printHeader({ log }) {
    const width = process.stdout?.columns ? process.stdout?.columns - 2 : 100

    console.clear()

    log.info(
      chalk.magenta(`
${renderDivider({ color: chalk.green, title: chalk.green.bold("🌳  garden dev 🌳 "), width })}

${chalk.bold(`Good ${getGreetingTime()}! Welcome to the Garden interactive development console.`)}

Here, you can ${chalk.white("build")}, ${chalk.white("deploy")}, ${chalk.white("test")} and ${chalk.white("run")} anything in your project, start code syncing, stream live logs and more.

Let's get your development environment wired up.
    `)
    )
  }

  getTerminalWriterType(): LoggerType {
    return "ink"
  }

  allowInDevCommand() {
    return false
  }

  async action(params: ActionParams): Promise<CommandResult> {
    const { log } = params

    const logger = log.root
    const terminalWriter = logger.getWriters().display

    let inkWriter: InkTerminalWriter
    // TODO: maybe enforce this elsewhere
    if (terminalWriter.type === "ink") {
      inkWriter = terminalWriter as InkTerminalWriter
    } else {
      throw new ParameterError(`This command can only be used with the ink logger type`, {
        writerTypes: {
          terminalWriter: terminalWriter.type,
          fileWriters: logger.getWriters().file.map((w) => w.type),
        },
      })
    }

    const commandLine = await this.initCommandHandler(params)

    const Dev: FC<{}> = ({}) => {
      // Stream log output directly to stdout, on top of the Ink components below
      const { stdout, write } = useStdout()
      inkWriter.setWriteCallback(write)

      const [line, setLine] = useState("🌸  Initializing...")
      const [status, setStatus] = useState("")
      const [message, setMessage] = useState("")
      const [spin, setSpin] = useState(false)

      // Note: Using callbacks here instead of events to make keypresses a bit more responsive
      commandLine.setCallbacks({
        commandLine: setLine,
        message: setMessage,
        status: (s: string) => {
          setSpin(!!s)
          setStatus(s)
        },
      })

      useInput((input, key) => {
        commandLine.handleInput(input, key)
      })

      const width = stdout ? stdout.columns - 2 : 50

      return (
        <Box flexDirection="column" paddingTop={1}>
          <Divider title={"🌼 🌸 🌷 🌺 🌻 "} width={width} dividerColor={"green"} padding={0} />
          <Box height={1} marginLeft={1}>
            <Text>{line}</Text>
          </Box>
          <Box height={1} marginTop={1} marginLeft={2}>
            {spin && (
              <Text color="cyanBright">
                <Spinner type="dots"></Spinner>
                &nbsp;&nbsp;
              </Text>
            )}
            <Text>{message || status}</Text>
          </Box>
        </Box>
      )
    }

    render(<Dev />, { exitOnCtrlC: false })

    await super.action({ ...params, commandLine })

    return {}
  }

  async reload(log: Log) {
    this.commandLine?.disable("🌸  Loading Garden project...")

    const manager = this.getManager(log)

    try {
      await manager.reload(log)

      // TODO: reload the last used project immediately
      // if (this.defaultGarden) {
      //   const newGarden = await manager.ensureInstance(
      //     log,
      //     this.defaultGarden.getInstanceKeyParams(),
      //     this.defaultGarden.opts
      //   )

      //   this.defaultGarden = newGarden

      //   // TODO: restart monitors
      // }

      this.commandLine?.flashSuccess(`Project successfully loaded!`)
    } catch (error) {
      log.error(`Failed loading the project: ${error}`)
      log.error({ error })
      this.commandLine?.flashError(
        `Failed loading the project. See above logs for details. Type ${chalk.white("reload")} to try again.`
      )
    } finally {
      this.commandLine?.enable()
    }
  }

  private async initCommandHandler(params: ActionParams) {
    const _this = this
    const { garden, log, opts } = params

    const manager = this.getManager(log)

    const cl = new CommandLine({
      log,
      manager,
      cwd: process.cwd(),
      // Add some command-line specific commands
      extraCommands: [new HelpCommand(), new QuitCommand(quit), new QuietCommand(), new QuiteCommand()],
      globalOpts: pick(opts, Object.keys(globalOptions)),
      history: await garden.localConfigStore.get("devCommandHistory"),
      serveCommand: this,
    })
    this.commandLine = cl

    function quitWithWarning() {
      // We ensure that the process exits at most 5 seconds after a SIGINT / ctrl-c.
      setTimeout(() => {
        // eslint-disable-next-line no-console
        console.error(chalk.red("\nTimed out waiting for Garden to exit. This is a bug, please report it!"))
        process.exit(1)
      }, 5000)

      garden
        .emitWarning({
          log,
          key: "dev-syncs-active",
          message: chalk.yellow(
            `Syncs started during this session may still be active when this command terminates. You can run ${chalk.white(
              "garden sync stop '*'"
            )} to stop all code syncs. Hint: To stop code syncing when exiting ${chalk.white(
              "garden dev"
            )}, use ${chalk.white("Ctrl-D")} or the ${chalk.white(`exit`)} command.`
          ),
        })
        .catch(() => {})
        .finally(() => quit())
    }

    function quit() {
      cl?.disable("🌷  Thanks for stopping by, love you! ❤️")
      _this.terminate()
    }

    process.on("SIGINT", quitWithWarning)

    // Support ctrl-c and ctrl-d to exit
    cl.setKeyHandler("ctrl-d", quit)
    cl.setKeyHandler("ctrl-c", quitWithWarning)

    return cl
  }
}

/**
 * Help/utility commands
 */
class HelpCommand extends ConsoleCommand {
  name = "help"
  help = ""
  hidden = true

  async action({ commandLine }: CommandParams) {
    commandLine?.showHelp()
    return {}
  }
}

class QuitCommand extends ConsoleCommand {
  name = "quit"
  help = "Exit the dev console."
  aliases = ["exit"]

  constructor(private quit: () => void) {
    super(quit)
  }

  async action() {
    this.quit()
    return {}
  }
}

class QuietCommand extends ConsoleCommand {
  name = "quiet"
  help = ""
  hidden = true

  async action({ commandLine }: CommandParams) {
    commandLine?.flashMessage(chalk.italic("Shh!"), { prefix: "🤫  " })
    return {}
  }
}

class QuiteCommand extends ConsoleCommand {
  name = "quite"
  help = ""
  hidden = true

  async action({ commandLine }: CommandParams) {
    commandLine?.flashMessage(chalk.italic("Indeed!"), { prefix: "🎩  " })
    return {}
  }
}

function getGreetingTime() {
  const m = moment()

  const currentHour = parseFloat(m.format("HH"))

  if (currentHour >= 17) {
    return "evening"
  } else if (currentHour >= 12) {
    return "afternoon"
  } else {
    return "morning"
  }
}