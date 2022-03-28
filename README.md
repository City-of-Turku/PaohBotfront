# PaohBotfront

# Introduction

This repository is for Botfront which is an open source graphical UI for bot whisperers to develop and maintain bots created with Rasa. This is fork of the original [Botfront project](https://github.com/botfront/botfront)

Botfront can be run locally or deployed to the Azure cloud as Docker container.

# Documentation

The [official documentation](https://botfront.io/docs/rasa/getting-started/) of Botfront is hosted on [botfront.io](https://botfront.io/docs/rasa/getting-started/). Once you've installed the cli you can also use `botfront docs` to open it.

# Deploying to Azure cloud

Docker image are deployed to the test and production environments from `dev` and `main` branches respectively. The pipeline uses Azure Container registry to store created images and later deploys them to run as containers in AKS cluster under Private Network in Azure. The connection credentials are a part of the pipeline and those are fetched from Azure Key Vault as part of the pipeline.

To run the deployment it is enough to merge to dev and main branches after which new version is deployed.

The Azure Devops pipeline is defined in `azure-pipelines.yml` file and AKS Kubernetes configs are in `kube/` folder.

# Development locally

## How to build Botfront Docker locally

You can build docker image by running `docker build -f Dockerfile -t botfront .`

To run the Botfront docker, you also need a MongoDB container for Botfront to startup. For local use, there is `docker-compose.local.yml` docker compose file provided for starting up the Botfront together with Mongo. You can start it by running `docker compose -f docker-compose.local.yml up -d`

## How to develop Botfront locally

**!!Development version of Botfront doesn't seem to run on Windows so continue the process below with Linux or Mac!!**

1. Botfront is a Meteor app, so the first step is to [install Meteor](https://www.meteor.com/install)
2. Then clone this repo and install the dependencies:
```bash
git clone git@ssh.dev.azure.com:v3/turunkaupunki/VmPalvelukonsolidaatio/Botfront
cd botfront/botfront
meteor npm install
```
3. **Optional** (we don't really use the CLI ever): Install the CLI from the source code:
```bash
# if you installed Botfront CLI from npm uninstall it.
npm uninstall -g botfront
# Install the cli from the source code
cd cli && npm link
```
To run Botfront in local development mode:

- Start local Mongo container or use e.g. Azure Cosmos and set its port and authentication etc in `botfront/package.json` to the `MONGO_URL` parameter in row `"start:docker-compose.dev": "MODE=development BF_PROJECT_ID=bf MONGO_URL=mongodb://user:password@localhost:27017/bf meteor run"`
- Run Botfront with `meteor npm run start:docker-compose.dev`. Botfront will be available at [http://localhost:3000](http://localhost:3000) so open your browser and happy development :smile_cat:

### Commit messages naming convention

To help everyone with understanding the commit history of Botfront, we employ [`commitlint`](https://commitlint.js.org/#/) to enforce the commit styles:

```text
type(scope?): subject
```

where `type` is one of the following:

- build
- ci
- chore
- docs
- feat
- fix
- perf
- refactor
- revert
- style
- test

`scope` is optional, represents the module your commit working on.

`subject` explains the commit.

As an example, a commit that improved the documentation:
```text
docs(conversation builder): update slots manager screenshot.
```

# Testing

## Unit & Integration Testing
Unit tests are running through the meteor mocha package `meteortesting:mocha`.
Tests should be stored in `*.test.js` files beside the source code js files.

### Installation
* run `npm ci` to install the dependencies

### Run all tests
This will take a while
* run `npm run test-once`

### Run only tests related to the REST API
This will run all tests, which contain `REST:` within the description
* run `npm run test-rest`

## E2E Testing
End to end tests are using the Cypress testing framework.
The first test case `01_initial_setup_dont_change_name/initial_setup.spec.js` drops the mongo database on startup and creates own test user.
The test user is necessary to run the e2e tests.

```shell
email: test@test.com
password: aaaaaaaa00
```

### Installation
* install `mongo` client as the first testcase will drop the whole database via the mongo client
* run `meteor npm install` inside `botfront/cypress` to install the cypress plugins



### Run all tests
* run `meteor npm run start:docker-compose.dev` to run botfront in dev mode
* run `meteor npx cypress run`

### Run single test file with existing database
* create the aforementioned test user inside the system
* run `npx cypress run --spec cypress/<path_to_spec.js>`

### Run single test file with a clean database
* run `npx cypress run --spec cypress/integration/01_initial_setup_dont_change_name/initial_setup.spec.js` to drop the database and create test user one time
* run `npx cypress run --spec cypress/<path_to_spec.js>`

### Run tests from the Cypress UI
* create the test user via hand or via the first test case
* run `npx cypress open`

**Some tests also require Rasa to be available.**

<br/>

# License

Copyright (C) 2021 Dialogue Technologies Inc.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.(C) 2021 Dialogue Technologies Inc. All rights reserved.