{
    "name": "{%appName%}",
    "version": "0.1.0",
    "engines": {
        "node": ">=14 <=16"
    },
    "private": true,
    "dependencies": {
        "@fluentui/react-northstar": "^0.62.0",
        "@microsoft/mgt-element": "^2.8.0",
        "@microsoft/mgt-react": "^2.8.0",
        "@microsoft/mgt-teamsfx-provider": "^2.8.0",
        "@microsoft/microsoft-graph-client": "^3.0.1",
        "@microsoft/teams-js": "^2.7.1",
        "@microsoft/teamsfx": "^2.0.0",
        "@microsoft/teamsfx-react": "^2.0.0",
        "axios": "^0.21.1",
        "react": "^16.14.0",
        "react-dom": "^16.14.0",
        "react-router-dom": "^5.1.2",
        "react-scripts": "^5.0.1"
    },
    "devDependencies": {
        "@microsoft/teamsfx-run-utils": "alpha"
    },
    "scripts": {
        "dev:teamsfx": "node script/run.js . teamsfx/.env.local",
        "start": "react-scripts start",
        "build": "react-scripts build",
        "eject": "react-scripts eject",
        "test": "echo \"Error: no test specified\" && exit 1"
    },
    "eslintConfig": {
        "extends": [
            "react-app",
            "react-app/jest"
        ]
    },
    "browserslist": {
        "production": [
            ">0.2%",
            "not dead",
            "not op_mini all"
        ],
        "development": [
            "last 1 chrome version",
            "last 1 firefox version",
            "last 1 safari version"
        ]
    },
    "homepage": "."
}