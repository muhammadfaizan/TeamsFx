version: 1.0.0

registerApp:
  - uses: teamsApp/create # Creates a Teams app
    with:
      name: ${{TEAMS_APP_NAME}} # Teams app name
    # Output: following environment variable will be persisted in current environment's .env file.
    # TEAMS_APP_ID: the id of Teams app

provision:
  - uses: botAadApp/create # Creates a new AAD app for bot if BOT_ID environment variable is empty
    with:
      name: {%appName%}
    # Output: following environment variable will be persisted in current environment's .env file.
    # BOT_ID: the AAD app client id created for bot
    # SECRET_BOT_PASSWORD: the AAD app client secret created for bot

  - uses: botFramework/create # Create or update the bot registration on dev.botframework.com
    with:
      botId: ${{BOT_ID}}
      name: {%appName%}
      messagingEndpoint: ${{BOT_ENDPOINT}}/api/messages
      description: ""
      channels:
        - name: msteams

configureApp:
  - uses: file/updateEnv # Generate env to .env file
    with:
      envs:
        TAB_DOMAIN: localhost:53000
        TAB_ENDPOINT: https://localhost:53000
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
      appPackagePath: ./build/appPackage/appPackage.${{TEAMSFX_ENV}}.zip # Relative path to this file. This is the path for built zip file.
    # Output: following environment variable will be persisted in current environment's .env file.
    # TEAMS_APP_ID: the id of Teams app

deploy:
  - uses: prerequisite/install # Install dependencies
    with:
      devCert:
        trust: true
    # Output: following environment variable will be persisted in current environment's .env file.
    # SSL_CRT_FILE: certificate file
    # SSL_KEY_FILE: certificate key

  - uses: cli/runNpmCommand # Run npm command
    with:
      args: install --no-audit