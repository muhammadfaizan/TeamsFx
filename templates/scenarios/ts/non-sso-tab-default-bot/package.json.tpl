{
    "name": "{%appName%}",
    "version": "0.0.1",
    "author": "Microsoft",
    "license": "MIT",
    "scripts": {
        "test": "echo \"Error: no test specified\" && exit 1",
        "install:bot": "cd bot && npm install",
        "install:tab": "cd tab && npm install",
        "install": "concurrently \"npm run install:bot\" \"npm run install:tab\"",
        "dev:bot": "cd bot && npm run dev",
        "start:tab": "cd tab && npm run start",
        "build:tab": "cd tab && npm run build",
        "build:bot": "cd bot && npm run build",
        "build": "concurrently \"npm run build:tab\" \"npm run build:bot\""
    },
    "devDependencies": {
        "@microsoft/teamsfx-run-utils": "alpha"
    },
    "dependencies": {
        "concurrently": "^7.6.0"
    },
    "license": "MIT"
}