import tmp from "tmp-promise"
import { ProjectConfig } from "../../../../../src/config/project"
import execa = require("execa")
import { DEFAULT_API_VERSION } from "../../../../../src/constants"
import { Garden } from "../../../../../src/garden"
import { getDataDir } from "../../../../helpers"
import { expect } from "chai"
import stripAnsi from "strip-ansi"
import { dedent } from "../../../../../src/util/string"
import { TestTask } from "../../../../../src/tasks/test"
import { writeFile, remove, pathExists } from "fs-extra"
import { join } from "path"

describe("hadolint provider", () => {
  let tmpDir: tmp.DirectoryResult
  let tmpPath: string
  let projectConfigFoo: ProjectConfig
  let projectHadolintConfigPath: string

  before(async () => {
    tmpDir = await tmp.dir({ unsafeCleanup: true })
    tmpPath = tmpDir.path

    await execa("git", ["init"], { cwd: tmpPath })

    projectConfigFoo = {
      apiVersion: DEFAULT_API_VERSION,
      kind: "Project",
      name: "test",
      path: tmpPath,
      defaultEnvironment: "default",
      dotIgnoreFiles: [],
      environments: [{ name: "default", variables: {} }],
      providers: [{ name: "hadolint" }],
      variables: {},
    }

    projectHadolintConfigPath = join(tmpPath, ".hadolint.yaml")
  })

  after(async () => {
    await tmpDir.cleanup()
  })

  afterEach(async () => {
    if (await pathExists(projectHadolintConfigPath)) {
      await remove(projectHadolintConfigPath)
    }
  })

  it("should add a hadolint module for each container module with a Dockerfile", async () => {
    const garden = await Garden.factory(tmpPath, {
      plugins: [],
      config: projectConfigFoo,
    })

    garden["moduleConfigs"] = {
      // With Dockerfile
      foo: {
        apiVersion: DEFAULT_API_VERSION,
        name: "foo",
        type: "container",
        allowPublish: false,
        build: { dependencies: [] },
        outputs: {},
        path: tmpPath,
        serviceConfigs: [],
        taskConfigs: [],
        testConfigs: [],
        spec: { dockerfile: "foo.Dockerfile" },
      },
      // Without Dockerfile
      bar: {
        apiVersion: DEFAULT_API_VERSION,
        name: "bar",
        type: "container",
        allowPublish: false,
        build: { dependencies: [] },
        outputs: {},
        path: tmpPath,
        serviceConfigs: [],
        taskConfigs: [],
        testConfigs: [],
        spec: {},
      },
    }

    const graph = await garden.getConfigGraph(garden.log)
    const module = await graph.getModule("hadolint-foo")

    expect(module.path).to.equal(tmpPath)
    expect(module.spec).to.eql({
      build: { dependencies: [] },
      dockerfilePath: "foo.Dockerfile",
    })
  })

  it("should add a hadolint module for module types inheriting from container", async () => {
    const foo = {
      name: "foo",
      dependencies: ["container"],
      createModuleTypes: [
        {
          name: "foo",
          base: "container",
          docs: "foo",
          handlers: {},
        },
      ],
    }

    const garden = await Garden.factory(tmpPath, {
      plugins: [foo],
      config: {
        ...projectConfigFoo,
        providers: [...projectConfigFoo.providers, { name: "foo" }],
      },
    })

    garden["moduleConfigs"] = {
      foo: {
        apiVersion: DEFAULT_API_VERSION,
        name: "foo",
        type: "foo",
        allowPublish: false,
        build: { dependencies: [] },
        outputs: {},
        path: tmpPath,
        serviceConfigs: [],
        taskConfigs: [],
        testConfigs: [],
        spec: { dockerfile: "foo.Dockerfile" },
      },
    }

    const graph = await garden.getConfigGraph(garden.log)
    const module = await graph.getModule("hadolint-foo")

    expect(module.path).to.equal(tmpPath)
    expect(module.spec).to.eql({
      build: { dependencies: [] },
      dockerfilePath: "foo.Dockerfile",
    })
  })

  describe("testModule", () => {
    const path = getDataDir("hadolint")

    it("should format warnings and errors nicely", async () => {
      const garden = await Garden.factory(tmpPath, {
        plugins: [],
        config: projectConfigFoo,
      })

      garden["moduleConfigs"] = {
        foo: {
          apiVersion: DEFAULT_API_VERSION,
          name: "foo",
          type: "hadolint",
          allowPublish: false,
          build: { dependencies: [] },
          outputs: {},
          path,
          serviceConfigs: [],
          taskConfigs: [],
          testConfigs: [{ name: "foo", dependencies: [], spec: {}, timeout: 10 }],
          spec: { dockerfilePath: "errAndWarn.Dockerfile" },
        },
      }

      const graph = await garden.getConfigGraph(garden.log)
      const module = await graph.getModule("foo")

      const testTask = new TestTask({
        garden,
        module,
        log: garden.log,
        graph,
        testConfig: module.testConfigs[0],
        force: true,
        forceBuild: false,
        version: module.version,
      })

      const key = testTask.getKey()
      const { [key]: result } = await garden.processTasks([testTask])

      expect(result).to.exist
      expect(result!.error).to.exist
      expect(stripAnsi(result!.error!.message)).to.equal(dedent`
      hadolint reported 1 error(s) and 1 warning(s):

      DL3007: Using latest is prone to errors if the image will ever update. Pin the version explicitly to a release tag
      1:   FROM busybox:latest
      -----^
      DL4000: MAINTAINER is deprecated
      2:   MAINTAINER foo
      -----^
      `)
    })

    it("should prefer a .hadolint.yaml in the module root if it's available", async () => {
      const garden = await Garden.factory(tmpPath, {
        plugins: [],
        config: projectConfigFoo,
      })

      // Write a config to the project root, that should _not_ be used in this test
      await writeFile(
        projectHadolintConfigPath,
        dedent`
          ignored:
          - DL4000
        `
      )

      const modulePath = getDataDir("hadolint", "ignore-dl3007")

      garden["moduleConfigs"] = {
        foo: {
          apiVersion: DEFAULT_API_VERSION,
          name: "foo",
          type: "hadolint",
          allowPublish: false,
          build: { dependencies: [] },
          outputs: {},
          path: modulePath,
          serviceConfigs: [],
          taskConfigs: [],
          testConfigs: [{ name: "foo", dependencies: [], spec: {}, timeout: 10 }],
          spec: { dockerfilePath: "errAndWarn.Dockerfile" },
        },
      }

      const graph = await garden.getConfigGraph(garden.log)
      const module = await graph.getModule("foo")

      const testTask = new TestTask({
        garden,
        module,
        log: garden.log,
        graph,
        testConfig: module.testConfigs[0],
        force: true,
        forceBuild: false,
        version: module.version,
      })

      const key = testTask.getKey()
      const { [key]: result } = await garden.processTasks([testTask])

      expect(result).to.exist
      expect(result!.error).to.exist
      expect(stripAnsi(result!.error!.message)).to.equal(dedent`
      hadolint reported 1 error(s) and 0 warning(s):

      DL4000: MAINTAINER is deprecated
      2:   MAINTAINER foo
      -----^
      `)
    })

    it("should use a .hadolint.yaml in the project root if there's none in the module root", async () => {
      const garden = await Garden.factory(tmpPath, {
        plugins: [],
        config: projectConfigFoo,
      })

      // Write a config to the project root, that should _not_ be used in this test
      await writeFile(
        projectHadolintConfigPath,
        dedent`
          ignored:
          - DL3007
        `
      )

      garden["moduleConfigs"] = {
        foo: {
          apiVersion: DEFAULT_API_VERSION,
          name: "foo",
          type: "hadolint",
          allowPublish: false,
          build: { dependencies: [] },
          outputs: {},
          path,
          serviceConfigs: [],
          taskConfigs: [],
          testConfigs: [{ name: "foo", dependencies: [], spec: {}, timeout: 10 }],
          spec: { dockerfilePath: "errAndWarn.Dockerfile" },
        },
      }

      const graph = await garden.getConfigGraph(garden.log)
      const module = await graph.getModule("foo")

      const testTask = new TestTask({
        garden,
        module,
        log: garden.log,
        graph,
        testConfig: module.testConfigs[0],
        force: true,
        forceBuild: false,
        version: module.version,
      })

      const key = testTask.getKey()
      const { [key]: result } = await garden.processTasks([testTask])

      expect(result).to.exist
      expect(result!.error).to.exist
      expect(stripAnsi(result!.error!.message)).to.equal(dedent`
      hadolint reported 1 error(s) and 0 warning(s):

      DL4000: MAINTAINER is deprecated
      2:   MAINTAINER foo
      -----^
      `)
    })

    it("should set success=false with a linting warning if testFailureThreshold=warning", async () => {
      const garden = await Garden.factory(tmpPath, {
        plugins: [],
        config: {
          ...projectConfigFoo,
          providers: [{ name: "hadolint", testFailureThreshold: "warning" }],
        },
      })

      garden["moduleConfigs"] = {
        foo: {
          apiVersion: DEFAULT_API_VERSION,
          name: "foo",
          type: "hadolint",
          allowPublish: false,
          build: { dependencies: [] },
          outputs: {},
          path,
          serviceConfigs: [],
          taskConfigs: [],
          testConfigs: [{ name: "foo", dependencies: [], spec: {}, timeout: 10 }],
          spec: { dockerfilePath: "warn.Dockerfile" },
        },
      }

      const graph = await garden.getConfigGraph(garden.log)
      const module = await graph.getModule("foo")

      const testTask = new TestTask({
        garden,
        module,
        log: garden.log,
        graph,
        testConfig: module.testConfigs[0],
        force: true,
        forceBuild: false,
        version: module.version,
      })

      const key = testTask.getKey()
      const { [key]: result } = await garden.processTasks([testTask])

      expect(result).to.exist
      expect(result!.error).to.exist
    })

    it("should set success=true with a linting warning if testFailureThreshold=error", async () => {
      const garden = await Garden.factory(tmpPath, {
        plugins: [],
        config: projectConfigFoo,
      })

      garden["moduleConfigs"] = {
        foo: {
          apiVersion: DEFAULT_API_VERSION,
          name: "foo",
          type: "hadolint",
          allowPublish: false,
          build: { dependencies: [] },
          outputs: {},
          path,
          serviceConfigs: [],
          taskConfigs: [],
          testConfigs: [{ name: "foo", dependencies: [], spec: {}, timeout: 10 }],
          spec: { dockerfilePath: "warn.Dockerfile" },
        },
      }

      const graph = await garden.getConfigGraph(garden.log)
      const module = await graph.getModule("foo")

      const testTask = new TestTask({
        garden,
        module,
        log: garden.log,
        graph,
        testConfig: module.testConfigs[0],
        force: true,
        forceBuild: false,
        version: module.version,
      })

      const key = testTask.getKey()
      const { [key]: result } = await garden.processTasks([testTask])

      expect(result).to.exist
      expect(result!.error).to.not.exist
    })

    it("should set success=true with warnings and errors if testFailureThreshold=none", async () => {
      const garden = await Garden.factory(tmpPath, {
        plugins: [],
        config: {
          ...projectConfigFoo,
          providers: [{ name: "hadolint", testFailureThreshold: "none" }],
        },
      })

      garden["moduleConfigs"] = {
        foo: {
          apiVersion: DEFAULT_API_VERSION,
          name: "foo",
          type: "hadolint",
          allowPublish: false,
          build: { dependencies: [] },
          outputs: {},
          path,
          serviceConfigs: [],
          taskConfigs: [],
          testConfigs: [{ name: "foo", dependencies: [], spec: {}, timeout: 10 }],
          spec: { dockerfilePath: "errAndWarn.Dockerfile" },
        },
      }

      const graph = await garden.getConfigGraph(garden.log)
      const module = await graph.getModule("foo")

      const testTask = new TestTask({
        garden,
        module,
        log: garden.log,
        graph,
        testConfig: module.testConfigs[0],
        force: true,
        forceBuild: false,
        version: module.version,
      })

      const key = testTask.getKey()
      const { [key]: result } = await garden.processTasks([testTask])

      expect(result).to.exist
      expect(result!.error).to.not.exist
    })
  })
})
