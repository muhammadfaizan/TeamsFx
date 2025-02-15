// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import "mocha";
import * as sinon from "sinon";
import chai from "chai";
import fs from "fs-extra";
import { PackageService } from "../../../../src/common/m365/packageService";
import { M365TitleAcquireDriver } from "../../../../src/component/driver/m365/acquire";
import {
  MockedLogProvider,
  MockedM365Provider,
  MockedUserInteraction,
} from "../../../plugins/solution/util";

describe("m365Title/acquire", async () => {
  const acquireDriver = new M365TitleAcquireDriver();
  const mockedDriverContext: any = {
    m365TokenProvider: new MockedM365Provider(),
    logProvider: new MockedLogProvider(),
    ui: new MockedUserInteraction(),
    projectPath: "./",
  };

  afterEach(() => {
    sinon.restore();
  });

  it("should throw error if file not exists", async () => {
    const args = {
      appPackagePath: "fakePath",
    };

    const result = await acquireDriver.run(args, mockedDriverContext);
    chai.assert(result.isErr());
    if (result.isErr()) {
      chai.assert.equal(result.error.name, "FileNotFound");
    }
  });

  it("invalid param error", async () => {
    const args = {
      appPackagePath: false,
    } as any;

    const result = await acquireDriver.run(args, mockedDriverContext);
    chai.assert(result.isErr());
    if (result.isErr()) {
      chai.assert.equal(result.error.name, "InvalidParameter");
    }
  });

  it("run happy path", async () => {
    const args = {
      appPackagePath: "fakePath",
    };

    sinon.stub(PackageService.prototype, "sideLoading").resolves("test-title-id");
    sinon.stub(fs, "pathExists").resolves(true);

    const result = await acquireDriver.run(args, mockedDriverContext);
    chai.assert.isTrue(result.isOk());
    chai.assert.equal((result as any).value.get("M365_TITLE_ID"), "test-title-id");
  });

  it("execute happy path", async () => {
    const args = {
      appPackagePath: "fakePath",
    };

    sinon.stub(PackageService.prototype, "sideLoading").resolves("test-title-id");
    sinon.stub(fs, "pathExists").resolves(true);

    const result = await acquireDriver.execute(args, mockedDriverContext);
    chai.assert.isTrue(result.result.isOk());
    chai.assert.equal((result.result as any).value.get("M365_TITLE_ID"), "test-title-id");
  });
});
