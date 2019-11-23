import { Garden } from "../../../src/garden"
import { makeTestGardenA } from "../../helpers"
import { ConfigGraph } from "../../../src/config-graph"
import { prepareRuntimeContext } from "../../../src/runtime-context"
import { expect } from "chai"

describe("prepareRuntimeContext", () => {
  let garden: Garden
  let graph: ConfigGraph

  before(async () => {
    garden = await makeTestGardenA()
    graph = await garden.getConfigGraph(garden.log)
  })

  it("should add the module version to the output envVars", async () => {
    const module = await graph.getModule("module-a")

    const runtimeContext = await prepareRuntimeContext({
      garden,
      graph,
      module,
      dependencies: {
        build: [],
        service: [],
        task: [],
        test: [],
      },
      serviceStatuses: {},
      taskResults: {},
    })

    expect(runtimeContext.envVars.GARDEN_VERSION).to.equal(module.version.versionString)
  })

  it("should add project variables to the output envVars", async () => {
    const module = await graph.getModule("module-a")

    garden["variables"]["my-var"] = "foo"

    const runtimeContext = await prepareRuntimeContext({
      garden,
      graph,
      module,
      dependencies: {
        build: [],
        service: [],
        task: [],
        test: [],
      },
      serviceStatuses: {},
      taskResults: {},
    })

    expect(runtimeContext.envVars.GARDEN_VARIABLES_MY_VAR).to.equal("foo")
  })

  it("should add outputs for every build dependency output", async () => {
    const module = await graph.getModule("module-a")
    const moduleB = await graph.getModule("module-b")

    moduleB.outputs = { "my-output": "meep" }

    const runtimeContext = await prepareRuntimeContext({
      garden,
      graph,
      module,
      dependencies: {
        build: [moduleB],
        service: [],
        task: [],
        test: [],
      },
      serviceStatuses: {},
      taskResults: {},
    })

    expect(runtimeContext.dependencies).to.eql([
      {
        moduleName: "module-b",
        name: "module-b",
        outputs: moduleB.outputs,
        type: "build",
        version: moduleB.version.versionString,
      },
    ])

    expect(runtimeContext.envVars.GARDEN_MODULE_MODULE_B__OUTPUT_MY_OUTPUT).to.equal("meep")
  })

  it("should add outputs for every service dependency runtime output", async () => {
    const module = await graph.getModule("module-a")
    const serviceB = await graph.getService("service-b")

    const outputs = {
      "my-output": "moop",
    }

    const runtimeContext = await prepareRuntimeContext({
      garden,
      graph,
      module,
      dependencies: {
        build: [],
        service: [serviceB],
        task: [],
        test: [],
      },
      serviceStatuses: {
        "service-b": {
          state: "ready",
          outputs,
          detail: {},
        },
      },
      taskResults: {},
    })

    expect(runtimeContext.dependencies).to.eql([
      {
        moduleName: "module-b",
        name: "service-b",
        outputs,
        type: "service",
        version: serviceB.module.version.versionString,
      },
    ])

    expect(runtimeContext.envVars.GARDEN_SERVICE_SERVICE_B__OUTPUT_MY_OUTPUT).to.equal("moop")
  })

  it("should add outputs for every task dependency runtime output", async () => {
    const module = await graph.getModule("module-a")
    const taskB = await graph.getTask("task-b")

    const outputs = {
      "my-output": "mewp",
    }

    const runtimeContext = await prepareRuntimeContext({
      garden,
      graph,
      module,
      dependencies: {
        build: [],
        service: [],
        task: [taskB],
        test: [],
      },
      serviceStatuses: {},
      taskResults: {
        "task-b": {
          command: ["foo"],
          completedAt: new Date(),
          log: "mewp",
          moduleName: "module-b",
          outputs,
          startedAt: new Date(),
          success: true,
          taskName: "task-b",
          version: taskB.module.version.versionString,
        },
      },
    })

    expect(runtimeContext.dependencies).to.eql([
      {
        moduleName: "module-b",
        name: "task-b",
        outputs,
        type: "task",
        version: taskB.module.version.versionString,
      },
    ])

    expect(runtimeContext.envVars.GARDEN_TASK_TASK_B__OUTPUT_MY_OUTPUT).to.equal("mewp")
  })

  it("should add output envVars for every module dependency, incl. task and service dependency modules", async () => {
    const module = await graph.getModule("module-a")
    const serviceB = await graph.getService("service-b")
    const taskB = await graph.getTask("task-c")

    serviceB.module.outputs = { "module-output-b": "meep" }
    taskB.module.outputs = { "module-output-c": "moop" }

    const runtimeContext = await prepareRuntimeContext({
      garden,
      graph,
      module,
      dependencies: {
        build: [],
        service: [serviceB],
        task: [taskB],
        test: [],
      },
      serviceStatuses: {},
      taskResults: {},
    })

    expect(runtimeContext.envVars.GARDEN_MODULE_MODULE_B__OUTPUT_MODULE_OUTPUT_B).to.equal("meep")
    expect(runtimeContext.envVars.GARDEN_MODULE_MODULE_C__OUTPUT_MODULE_OUTPUT_C).to.equal("moop")
  })

  it("should output the list of dependencies as an env variable", async () => {
    const module = await graph.getModule("module-a")
    const serviceB = await graph.getService("service-b")
    const taskB = await graph.getTask("task-c")

    const runtimeContext = await prepareRuntimeContext({
      garden,
      graph,
      module,
      dependencies: {
        build: [],
        service: [serviceB],
        task: [taskB],
        test: [],
      },
      serviceStatuses: {},
      taskResults: {},
    })

    const parsed = JSON.parse(runtimeContext.envVars.GARDEN_DEPENDENCIES as string)

    expect(parsed).to.eql(runtimeContext.dependencies)
  })
})
