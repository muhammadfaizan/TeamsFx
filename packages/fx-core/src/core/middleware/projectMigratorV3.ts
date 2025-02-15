// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
  AppPackageFolderName,
  err,
  FxError,
  ok,
  ProjectSettings,
  SettingsFolderName,
  SystemError,
  UserError,
  InputConfigsFolderName,
  Platform,
  Inputs,
  Stage,
} from "@microsoft/teamsfx-api";
import { Middleware, NextFunction } from "@feathersjs/hooks/lib";
import { CoreHookContext } from "../types";
import { backupFolder, MigrationContext } from "./utils/migrationContext";
import { checkMethod, checkUserTasks, learnMoreText, upgradeButton } from "./projectMigrator";
import * as path from "path";
import { loadProjectSettingsByProjectPathV2 } from "./projectSettingsLoader";
import {
  Component,
  ProjectMigratorStatus,
  sendTelemetryErrorEvent,
  sendTelemetryEvent,
  TelemetryEvent,
  TelemetryProperty,
} from "../../common/telemetry";
import { ErrorConstants } from "../../component/constants";
import { TOOLS } from "../globalVars";
import {
  UpgradeV3CanceledError,
  MigrationError,
  AbandonedProjectError,
  ToolkitNotSupportError,
} from "../error";
import { AppYmlGenerator } from "./utils/appYmlGenerator";
import * as fs from "fs-extra";
import { MANIFEST_TEMPLATE_CONSOLIDATE } from "../../component/resource/appManifest/constants";
import { replacePlaceholdersForV3, FileType } from "./utils/MigrationUtils";
import {
  readAndConvertUserdata,
  fsReadDirSync,
  generateAppIdUri,
  getProjectVersion,
  jsonObjectNamesConvertV3,
  getCapabilitySsoStatus,
  readBicepContent,
  readJsonFile,
  replaceAppIdUri,
  updateAndSaveManifestForSpfx,
  getTemplateFolderPath,
  getParameterFromCxt,
  migrationNotificationMessage,
  outputCancelMessage,
  getDownloadLinkByVersionAndPlatform,
  getVersionState,
} from "./utils/v3MigrationUtils";
import * as commentJson from "comment-json";
import { DebugMigrationContext } from "./utils/debug/debugMigrationContext";
import {
  getPlaceholderMappings,
  isCommentObject,
  readJsonCommentFile,
} from "./utils/debug/debugV3MigrationUtils";
import {
  migrateTransparentLocalTunnel,
  migrateTransparentPrerequisite,
  migrateTransparentNpmInstall,
  migrateSetUpTab,
  migrateSetUpSSO,
  migratePrepareManifest,
  migrateSetUpBot,
  migrateValidateDependencies,
  migrateBackendExtensionsInstall,
  migrateFrontendStart,
  migrateValidateLocalPrerequisites,
  migrateNgrokStartTask,
  migrateNgrokStartCommand,
  migrateBotStart,
  migrateAuthStart,
  migrateBackendWatch,
  migrateBackendStart,
  migratePreDebugCheck,
} from "./utils/debug/taskMigrator";
import { AppLocalYmlGenerator } from "./utils/debug/appLocalYmlGenerator";
import { EOL } from "os";
import { getTemplatesFolder } from "../../folder";
import { MetadataV2, MetadataV3, VersionSource, VersionState } from "../../common/versionMetadata";
import { isMigrationV3Enabled, isSPFxProject } from "../../common/tools";
import { VersionForMigration } from "./types";
import { environmentManager } from "../environment";
import { getLocalizedString } from "../../common/localizeUtils";

const Constants = {
  vscodeProvisionBicepPath: "./templates/azure/provision.bicep",
  launchJsonPath: ".vscode/launch.json",
  tasksJsonPath: ".vscode/tasks.json",
  reportName: "migrationReport.md",
  envWriteOption: {
    // .env.{env} file might be already exist, use append mode (flag: a+)
    encoding: "utf8",
    flag: "a+",
  },
  envFilePrefix: ".env.",
};

const learnMoreLink = "https://aka.ms/teams-toolkit-5.0-upgrade";
export const errorNames = {
  appPackageNotExist: "AppPackageNotExist",
  manifestTemplateNotExist: "ManifestTemplateNotExist",
};
const migrationMessageButtons = [learnMoreText, upgradeButton];

type Migration = (context: MigrationContext) => Promise<void>;
const subMigrations: Array<Migration> = [
  preMigration,
  manifestsMigration,
  generateAppYml,
  generateLocalConfig,
  configsMigration,
  statesMigration,
  userdataMigration,
  generateApimPluginEnvContent,
  updateLaunchJson,
  azureParameterMigration,
  debugMigration,
  updateGitignore,
];

export const ProjectMigratorMWV3: Middleware = async (ctx: CoreHookContext, next: NextFunction) => {
  const versionForMigration = await checkVersionForMigration(ctx);
  // abandoned v3 project which will not be supported. Show user the message to create new project.
  if (versionForMigration.source === VersionSource.settings) {
    await TOOLS?.ui.showMessage(
      "warn",
      getLocalizedString("core.migrationV3.abandonedProject"),
      true
    );
    ctx.result = err(AbandonedProjectError());
  } else if (versionForMigration.state === VersionState.upgradeable && checkMethod(ctx)) {
    if (!checkUserTasks(ctx)) {
      ctx.result = ok(undefined);
      return;
    }
    if (!isMigrationV3Enabled()) {
      await TOOLS?.ui.showMessage(
        "warn",
        getLocalizedString("core.migrationV3.CreateNewProject"),
        true
      );
      ctx.result = err(ToolkitNotSupportError());
      return false;
    }

    const skipUserConfirm = getParameterFromCxt(ctx, "skipUserConfirm");
    if (!skipUserConfirm && !(await askUserConfirm(ctx, versionForMigration))) {
      return;
    }
    const migrationContext = await MigrationContext.create(ctx);
    await wrapRunMigration(migrationContext, migrate);
    ctx.result = ok(undefined);
  } else {
    // continue next step only when:
    // 1. no need to upgrade the project;
    // 2. no need to update Teams Toolkit version;
    await next();
  }
};

export async function wrapRunMigration(
  context: MigrationContext,
  exec: (context: MigrationContext) => void
): Promise<void> {
  try {
    sendTelemetryEvent(Component.core, TelemetryEvent.ProjectMigratorMigrateStartV3);
    await exec(context);
    await showSummaryReport(context);
    sendTelemetryEvent(
      Component.core,
      TelemetryEvent.ProjectMigratorMigrateV3,
      context.telemetryProperties
    );
  } catch (error: any) {
    let fxError: FxError;
    if (error instanceof UserError || error instanceof SystemError) {
      fxError = error;
    } else {
      if (!(error instanceof Error)) {
        error = new Error(error.toString());
      }
      fxError = new SystemError({
        error,
        source: Component.core,
        name: ErrorConstants.unhandledError,
        message: error.message,
        displayMessage: error.message,
      });
    }
    sendTelemetryErrorEvent(
      Component.core,
      TelemetryEvent.ProjectMigratorV3Error,
      fxError,
      context.telemetryProperties
    );
    await rollbackMigration(context);
    throw error;
  }
  await context.removeFxV2();
}

async function rollbackMigration(context: MigrationContext): Promise<void> {
  await context.cleanModifiedPaths();
  await context.restoreBackup();
  await context.cleanBackup();
}

async function showSummaryReport(context: MigrationContext): Promise<void> {
  const summaryPath = path.join(context.backupPath, Constants.reportName);
  const templatePath = path.join(getTemplatesFolder(), "core/v3Migration", Constants.reportName);

  const content = await fs.readFile(templatePath);
  await fs.writeFile(summaryPath, content);
  await TOOLS?.ui?.openFile?.(summaryPath);
}

export async function migrate(context: MigrationContext): Promise<void> {
  for (const subMigration of subMigrations) {
    await subMigration(context);
  }
}

async function preMigration(context: MigrationContext): Promise<void> {
  await context.backup(MetadataV2.configFolder);
}

export async function checkVersionForMigration(ctx: CoreHookContext): Promise<VersionForMigration> {
  const versionInfo = await getProjectVersion(ctx);
  const versionState = getVersionState(versionInfo);
  const platform = getParameterFromCxt(ctx, "platform", Platform.VSCode) as Platform;

  return {
    currentVersion: versionInfo.version,
    source: versionInfo.source,
    state: versionState,
    platform: platform,
  };
}

export async function generateAppYml(context: MigrationContext): Promise<void> {
  const bicepContent: string = await readBicepContent(context);
  const oldProjectSettings = await loadProjectSettings(context.projectPath);
  const appYmlGenerator = new AppYmlGenerator(
    oldProjectSettings,
    bicepContent,
    context.projectPath
  );
  const appYmlString: string = await appYmlGenerator.generateAppYml();
  await context.fsWriteFile(MetadataV3.configFile, appYmlString);
  if (oldProjectSettings.programmingLanguage?.toLowerCase() === "csharp") {
    const placeholderMappings = await getPlaceholderMappings(context);
    const appLocalYmlString: string = await appYmlGenerator.generateAppLocalYml(
      placeholderMappings
    );
    await context.fsWriteFile(MetadataV3.localConfigFile, appLocalYmlString);
  }
}

export async function updateLaunchJson(context: MigrationContext): Promise<void> {
  const launchJsonPath = path.join(context.projectPath, Constants.launchJsonPath);
  if (await fs.pathExists(launchJsonPath)) {
    await context.backup(Constants.launchJsonPath);
    const launchJsonContent = await fs.readFile(launchJsonPath, "utf8");
    const result = launchJsonContent
      .replace(/\${teamsAppId}/g, "${dev:teamsAppId}") // TODO: set correct default env if user deletes dev, wait for other PR to get env list utility
      .replace(/\${localTeamsAppId}/g, "${local:teamsAppId}")
      .replace(/\${localTeamsAppInternalId}/g, "${local:teamsAppInternalId}"); // For M365 apps
    await context.fsWriteFile(Constants.launchJsonPath, result);
  }
}

async function loadProjectSettings(projectPath: string): Promise<ProjectSettings> {
  const oldProjectSettings = await loadProjectSettingsByProjectPathV2(projectPath, true, true);
  if (oldProjectSettings.isOk()) {
    return oldProjectSettings.value;
  } else {
    throw oldProjectSettings.error;
  }
}

export async function manifestsMigration(context: MigrationContext): Promise<void> {
  // Backup templates/appPackage
  const oldAppPackageFolderPath = path.join(getTemplateFolderPath(context), AppPackageFolderName);
  const oldAppPackageFolderBackupRes = await context.backup(oldAppPackageFolderPath);

  if (!oldAppPackageFolderBackupRes) {
    // templates/appPackage does not exists
    // invalid teamsfx project
    throw MigrationError(
      new Error("templates/appPackage does not exist"),
      errorNames.appPackageNotExist,
      learnMoreLink
    );
  }

  // Ensure appPackage
  await context.fsEnsureDir(AppPackageFolderName);

  // Copy templates/appPackage/resources
  const oldResourceFolderPath = path.join(oldAppPackageFolderPath, "resources");
  const oldResourceFolderExists = await fs.pathExists(
    path.join(context.projectPath, oldResourceFolderPath)
  );
  if (oldResourceFolderExists) {
    const resourceFolderPath = path.join(AppPackageFolderName, "resources");
    await context.fsCopy(oldResourceFolderPath, resourceFolderPath);
  }

  // Read Bicep
  const bicepContent = await readBicepContent(context);

  // Read capability project settings
  const projectSettings = await loadProjectSettings(context.projectPath);
  const capabilities = getCapabilitySsoStatus(projectSettings);
  const appIdUri = generateAppIdUri(capabilities);
  const isSpfx = isSPFxProject(projectSettings);

  // Read Teams app manifest and save to templates/appPackage/manifest.template.json
  const oldManifestPath = path.join(oldAppPackageFolderPath, MANIFEST_TEMPLATE_CONSOLIDATE);
  const oldManifestExists = await fs.pathExists(path.join(context.projectPath, oldManifestPath));
  if (oldManifestExists) {
    const manifestPath = path.join(AppPackageFolderName, MANIFEST_TEMPLATE_CONSOLIDATE);
    let oldManifest = await fs.readFile(path.join(context.projectPath, oldManifestPath), "utf8");
    oldManifest = replaceAppIdUri(oldManifest, appIdUri);
    const manifest = replacePlaceholdersForV3(oldManifest, bicepContent);
    if (isSpfx) {
      await updateAndSaveManifestForSpfx(context, manifest);
    } else {
      await context.fsWriteFile(manifestPath, manifest);
    }
  } else {
    // templates/appPackage/manifest.template.json does not exist
    throw MigrationError(
      new Error("templates/appPackage/manifest.template.json does not exist"),
      errorNames.manifestTemplateNotExist,
      learnMoreLink
    );
  }

  // Read AAD app manifest and save to ./aad.manifest.template.json
  const oldAadManifestPath = path.join(oldAppPackageFolderPath, "aad.template.json");
  const oldAadManifestExists = await fs.pathExists(
    path.join(context.projectPath, oldAadManifestPath)
  );
  if (oldAadManifestExists) {
    let oldAadManifest = await fs.readFile(
      path.join(context.projectPath, oldAadManifestPath),
      "utf-8"
    );
    oldAadManifest = replaceAppIdUri(oldAadManifest, appIdUri);
    const aadManifest = replacePlaceholdersForV3(oldAadManifest, bicepContent);
    await context.fsWriteFile("aad.manifest.template.json", aadManifest);
  }

  await context.fsRemove(oldAppPackageFolderPath);
}

export async function azureParameterMigration(context: MigrationContext): Promise<void> {
  // Ensure `.fx/configs` exists
  const configFolderPath = path.join(".fx", InputConfigsFolderName);
  const configFolderPathExists = await context.fsPathExists(configFolderPath);
  if (!configFolderPathExists) {
    // Keep same practice now. Needs dicussion whether to throw error.
    return;
  }

  // Read Bicep
  const azureFolderPath = path.join(getTemplateFolderPath(context), "azure");
  const bicepContent = await readBicepContent(context);

  const fileNames = fsReadDirSync(context, configFolderPath);
  for (const fileName of fileNames) {
    if (!fileName.startsWith("azure.parameters.")) {
      continue;
    }

    const content = await fs.readFile(
      path.join(context.projectPath, configFolderPath, fileName),
      "utf-8"
    );

    const newContent = replacePlaceholdersForV3(content, bicepContent);
    await context.fsWriteFile(path.join(azureFolderPath, fileName), newContent);
  }
}

export async function askUserConfirm(
  ctx: CoreHookContext,
  versionForMigration: VersionForMigration
): Promise<boolean> {
  sendTelemetryEvent(Component.core, TelemetryEvent.ProjectMigratorNotificationStart);
  let answer;
  do {
    answer = await popupMessage(versionForMigration);
    if (answer === learnMoreText) {
      TOOLS?.ui!.openUrl(learnMoreLink);
    }
  } while (answer === learnMoreText);
  if (!answer || !migrationMessageButtons.includes(answer)) {
    sendTelemetryEvent(Component.core, TelemetryEvent.ProjectMigratorNotification, {
      [TelemetryProperty.Status]: ProjectMigratorStatus.Cancel,
    });
    const link = getDownloadLinkByVersionAndPlatform(
      versionForMigration.currentVersion,
      versionForMigration.platform
    );
    ctx.result = err(UpgradeV3CanceledError(link, versionForMigration.currentVersion));
    outputCancelMessage(versionForMigration.currentVersion, versionForMigration.platform);
    return false;
  }
  sendTelemetryEvent(Component.core, TelemetryEvent.ProjectMigratorNotification, {
    [TelemetryProperty.Status]: ProjectMigratorStatus.OK,
  });
  return true;
}

export async function popupMessage(
  versionForMigration: VersionForMigration
): Promise<string | undefined> {
  const res = await TOOLS?.ui.showMessage(
    "warn",
    migrationNotificationMessage(versionForMigration),
    true,
    ...migrationMessageButtons
  );
  return res?.isOk() ? res.value : undefined;
}

export async function generateLocalConfig(context: MigrationContext): Promise<void> {
  if (!(await context.fsPathExists(path.join(".fx", "configs", "config.local.json")))) {
    const oldProjectSettings = await loadProjectSettings(context.projectPath);
    await environmentManager.createLocalEnv(context.projectPath, oldProjectSettings.appName!);
  }
}

export async function configsMigration(context: MigrationContext): Promise<void> {
  // general
  if (await context.fsPathExists(path.join(".fx", "configs"))) {
    // if ./fx/states/ exists
    const fileNames = fsReadDirSync(context, path.join(".fx", "configs")); // search all files, get file names
    for (const fileName of fileNames)
      if (fileName.startsWith("config.")) {
        const fileRegex = new RegExp("(config\\.)([a-zA-Z0-9_-]*)(\\.json)", "g"); // state.*.json
        const fileNamesArray = fileRegex.exec(fileName);
        if (fileNamesArray != null) {
          // get envName
          const envName = fileNamesArray[2];
          // create .env.{env} file if not exist
          await context.fsEnsureDir(MetadataV3.defaultEnvironmentFolder);
          if (
            !(await context.fsPathExists(
              path.join(MetadataV3.defaultEnvironmentFolder, Constants.envFilePrefix + envName)
            ))
          )
            await context.fsCreateFile(
              path.join(MetadataV3.defaultEnvironmentFolder, Constants.envFilePrefix + envName)
            );
          const obj = await readJsonFile(
            context,
            path.join(".fx", "configs", "config." + envName + ".json")
          );
          if (obj["manifest"]) {
            const bicepContent = await readBicepContent(context);
            const teamsfx_env = fs
              .readFileSync(
                path.join(
                  context.projectPath,
                  MetadataV3.defaultEnvironmentFolder,
                  Constants.envFilePrefix + envName
                )
              )
              .toString()
              .includes("TEAMSFX_ENV=")
              ? ""
              : "TEAMSFX_ENV=" + envName + EOL;
            // convert every name and add the env name at the first line
            const envData =
              teamsfx_env +
              jsonObjectNamesConvertV3(
                obj["manifest"],
                "manifest.",
                "",
                FileType.CONFIG,
                bicepContent
              );
            await context.fsWriteFile(
              path.join(MetadataV3.defaultEnvironmentFolder, Constants.envFilePrefix + envName),
              envData,
              Constants.envWriteOption
            );
          }
        }
      }
  }
}

export async function statesMigration(context: MigrationContext): Promise<void> {
  // general
  if (await context.fsPathExists(path.join(".fx", "states"))) {
    // if ./fx/states/ exists
    const fileNames = fsReadDirSync(context, path.join(".fx", "states")); // search all files, get file names
    for (const fileName of fileNames)
      if (fileName.startsWith("state.")) {
        const fileRegex = new RegExp("(state\\.)([a-zA-Z0-9_-]*)(\\.json)", "g"); // state.*.json
        const fileNamesArray = fileRegex.exec(fileName);
        if (fileNamesArray != null) {
          // get envName
          const envName = fileNamesArray[2];
          // create .env.{env} file if not exist
          await context.fsEnsureDir(MetadataV3.defaultEnvironmentFolder);
          if (
            !(await context.fsPathExists(
              path.join(MetadataV3.defaultEnvironmentFolder, Constants.envFilePrefix + envName)
            ))
          )
            await context.fsCreateFile(
              path.join(MetadataV3.defaultEnvironmentFolder, Constants.envFilePrefix + envName)
            );
          const obj = await readJsonFile(
            context,
            path.join(".fx", "states", "state." + envName + ".json")
          );
          if (obj) {
            const bicepContent = await readBicepContent(context);
            // convert every name
            const envData = jsonObjectNamesConvertV3(
              obj,
              "state.",
              "",
              FileType.STATE,
              bicepContent
            );
            await context.fsWriteFile(
              path.join(MetadataV3.defaultEnvironmentFolder, Constants.envFilePrefix + envName),
              envData,
              Constants.envWriteOption
            );
          }
        }
      }
  }
}

export async function userdataMigration(context: MigrationContext): Promise<void> {
  // general
  if (await context.fsPathExists(path.join(".fx", "states"))) {
    // if ./fx/states/ exists
    const fileNames = fsReadDirSync(context, path.join(".fx", "states")); // search all files, get file names
    for (const fileName of fileNames)
      if (fileName.endsWith(".userdata")) {
        const fileRegex = new RegExp("([a-zA-Z0-9_-]*)(\\.userdata)", "g"); // state.*.json
        const fileNamesArray = fileRegex.exec(fileName);
        if (fileNamesArray != null) {
          // get envName
          const envName = fileNamesArray[1];
          // create .env.{env} file if not exist
          await context.fsEnsureDir(MetadataV3.defaultEnvironmentFolder);
          if (
            !(await context.fsPathExists(
              path.join(MetadataV3.defaultEnvironmentFolder, Constants.envFilePrefix + envName)
            ))
          )
            await context.fsCreateFile(
              path.join(MetadataV3.defaultEnvironmentFolder, Constants.envFilePrefix + envName)
            );
          const bicepContent = await readBicepContent(context);
          const envData = await readAndConvertUserdata(
            context,
            path.join(".fx", "states", fileName),
            bicepContent
          );
          await context.fsWriteFile(
            path.join(MetadataV3.defaultEnvironmentFolder, Constants.envFilePrefix + envName),
            envData,
            Constants.envWriteOption
          );
        }
      }
  }
}

export async function debugMigration(context: MigrationContext): Promise<void> {
  // Backup vscode/tasks.json
  await context.backup(Constants.tasksJsonPath);

  // Read .vscode/tasks.json
  const tasksJsonContent = await readJsonCommentFile(
    path.join(context.projectPath, Constants.tasksJsonPath)
  );
  if (!isCommentObject(tasksJsonContent) || !Array.isArray(tasksJsonContent["tasks"])) {
    // Invalid tasks.json content
    return;
  }

  // Migrate .vscode/tasks.json
  const migrateTaskFuncs = [
    migrateTransparentPrerequisite,
    migrateTransparentNpmInstall,
    migrateTransparentLocalTunnel,
    migrateSetUpTab,
    migrateSetUpBot,
    migrateSetUpSSO,
    migratePrepareManifest,
    migrateValidateDependencies,
    migrateBackendExtensionsInstall,
    migrateFrontendStart,
    migrateAuthStart,
    migrateBotStart,
    migrateBackendWatch,
    migrateBackendStart,
    migratePreDebugCheck,
    migrateValidateLocalPrerequisites,
    migrateNgrokStartTask,
    migrateNgrokStartCommand,
  ];

  const oldProjectSettings = await loadProjectSettings(context.projectPath);
  const placeholderMappings = await getPlaceholderMappings(context);

  const debugContext = new DebugMigrationContext(
    context,
    tasksJsonContent["tasks"],
    oldProjectSettings,
    placeholderMappings
  );

  for (const func of migrateTaskFuncs) {
    await func(debugContext);
  }

  // Write .vscode/tasks.json
  await context.fsWriteFile(
    Constants.tasksJsonPath,
    commentJson.stringify(tasksJsonContent, null, 4)
  );

  // Generate app.local.yml
  const appYmlGenerator = new AppLocalYmlGenerator(
    oldProjectSettings,
    debugContext.appYmlConfig,
    placeholderMappings
  );
  const appYmlString: string = await appYmlGenerator.generateAppYml();
  await context.fsWriteFile(MetadataV3.localConfigFile, appYmlString);
}

export function checkapimPluginExists(pjSettings: any): boolean {
  if (pjSettings && pjSettings["components"]) {
    for (const obj of pjSettings["components"])
      if (Object.keys(obj).includes("name") && obj["name"] === "apim") return true;
    return false;
  } else {
    return false;
  }
}

export async function generateApimPluginEnvContent(context: MigrationContext): Promise<void> {
  // general
  if (await context.fsPathExists(path.join(".fx", "configs", "projectSettings.json"))) {
    const projectSettingsContent = fs.readJsonSync(
      path.join(context.projectPath, ".fx", "configs", "projectSettings.json")
    );
    // judge if apim plugin exists
    if (checkapimPluginExists(projectSettingsContent)) {
      const fileNames = fsReadDirSync(context, path.join(".fx", "configs"));
      for (const fileName of fileNames)
        if (fileName.startsWith("config.")) {
          const fileRegex = new RegExp("(config.)([a-zA-Z0-9_-]*)(.json)", "g"); // state.*.json
          const fileNamesArray = fileRegex.exec(fileName);
          if (fileNamesArray != null) {
            // get envName
            const envName = fileNamesArray[2];
            if (envName != "local") {
              await context.fsEnsureDir(MetadataV3.defaultEnvironmentFolder);
              if (
                !(await context.fsPathExists(
                  path.join(MetadataV3.defaultEnvironmentFolder, Constants.envFilePrefix + envName)
                ))
              )
                await context.fsCreateFile(
                  path.join(MetadataV3.defaultEnvironmentFolder, Constants.envFilePrefix + envName)
                );
              const apimPluginAppendContent =
                "APIM__PUBLISHEREMAIL= # Teams Toolkit does not record your mail to protect your privacy, please fill your mail address here before provision to avoid failures" +
                EOL +
                "APIM__PUBLISHERNAME= # Teams Toolkit does not record your name to protect your privacy, please fill your name here before provision to avoid failures" +
                EOL;
              await context.fsWriteFile(
                path.join(MetadataV3.defaultEnvironmentFolder, Constants.envFilePrefix + envName),
                apimPluginAppendContent,
                Constants.envWriteOption
              );
            }
          }
        }
    }
  }
}

export async function updateGitignore(context: MigrationContext): Promise<void> {
  const gitignoreFile = ".gitignore";
  const ignoreFileExist: boolean = await context.backup(gitignoreFile);
  if (!ignoreFileExist) {
    context.fsCreateFile(gitignoreFile);
  }

  let ignoreFileContent: string = await fs.readFile(
    path.join(context.projectPath, gitignoreFile),
    "utf8"
  );
  ignoreFileContent +=
    EOL + path.join(MetadataV3.defaultEnvironmentFolder, Constants.envFilePrefix + "*");
  ignoreFileContent += EOL + `${backupFolder}/*`;

  await context.fsWriteFile(gitignoreFile, ignoreFileContent);
}
