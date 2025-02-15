version: 1.0.0

environmentFolderPath: ./env

deploy:
  - uses: cli/runNpmCommand
    with:
      args: install
      workingDirectory: ./src
  - uses: cli/runNpxCommand
    with:
      workingDirectory: ./src
      args: gulp bundle --ship --no-color
  - uses: cli/runNpxCommand
    with:
      workingDirectory: ./src
      args: gulp package-solution --ship --no-color
  - uses: spfx/deploy
    with:
      createAppCatalogIfNotExist: false
      packageSolutionPath: ./src/config/package-solution.json


registerApp:
  - uses: teamsApp/create # Creates a Teams app
    with:
      name: ${{TEAMS_APP_NAME}} # Teams app name
    # Output: following environment variable will be persisted in current environment's .env file.
    # TEAMS_APP_ID: the id of Teams app

configureApp:
  - uses: teamsApp/validate
    with:
      manifestPath: ./appPackage/manifest.template.json # Path to manifest template
  - uses: teamsApp/zipAppPackage # Build Teams app package with latest env value
    with:
      manifestPath: ./appPackage/manifest.template.json # Path to manifest template
      outputZipPath: ./build/appPackage/appPackage.${{TEAMSFX_ENV}}.zip
      outputJsonPath: ./build/appPackage/manifest.${{TEAMSFX_ENV}}.json
  - uses: teamsApp/update # Apply the Teams app manifest to an existing Teams app. Will use the app id in manifest file to determine which Teams app to update.
    with:
      appPackagePath: ./build/appPackage/appPackage.${{TEAMSFX_ENV}}.zip # Relative path to teamsfx folder. This is the path for built zip file.
      manifestTemplate: ./appPackage/manifest.template.json # Relative path to teamsfx folder. Environment variables in manifest will be replaced before apply to Teams app
    # Output: following environment variable will be persisted in current environment's .env file.
    # TEAMS_APP_ID: the id of Teams app

publish:
  - uses: teamsApp/validate
    with:
      manifestPath: ./appPackage/manifest.template.json # Path to manifest template
  - uses: teamsApp/zipAppPackage
    with:
      manifestPath: ./appPackage/manifest.template.json # Path to manifest template
      outputZipPath: ./build/appPackage/appPackage.${{TEAMSFX_ENV}}.zip
      outputJsonPath: ./build/manifest.${{TEAMSFX_ENV}}.json
  - uses: teamsApp/copyAppPackageToSPFx
    with:
      appPackagePath: ./build/appPackage/appPackage.${{TEAMSFX_ENV}}.zip
      spfxFolder: ./src
  - uses: teamsApp/publishAppPackage # Publish the app to Teams app catalog
    with:
      appPackagePath: ./build/appPackage/appPackage.${{TEAMSFX_ENV}}.zip
  # Output: following environment variable will be persisted in current environment's .env file.
  # TEAMS_APP_PUBLISHED_APP_ID: app id in Teams tenant app catalog.