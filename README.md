# iac-pulumi

Deploy a VPC along with associated resources using Pulumi on AWS.

## Overview

This Pulumi project sets up the following AWS resources:

- **VPC**: With a user-defined CIDR block.
- **Subnets**: Creates a user-defined number of subnets and evenly distributes them across available Availability Zones in the specified region.
- **Internet Gateway**: Attached to the VPC to enable communication between instances in the VPC and the internet.
- **Route Tables**: Configures a public and private route table, and associates them with the relevant subnets.

## Prerequisites

Ensure you have the following installed and configured before proceeding:

- [Pulumi CLI](https://www.pulumi.com/docs/get-started/install/)
- [AWS CLI](https://aws.amazon.com/cli/)
- [Node.js](https://nodejs.org/en/download/)

## Usage

### Setup

1. **Fork and Clone**: Fork this repository and clone it to your local machine.
2. **Navigate**: Use the terminal to navigate to the project directory.
3. **Install Dependencies**: Run `npm install`.

### Configuring AWS and Pulumi

Ensure your AWS credentials are configured by running `aws configure` and following the prompts.

Initialize a new Pulumi stack and set required configuration variables:
```sh
pulumi stack init <STACK_NAME>
pulumi config set aws:region <AWS_REGION>
pulumi config set vpcCidrBlock <CIDR_BLOCK>
pulumi config set numberOfSubnets <NUMBER_OF_SUBNETS>
```

## Deploying to AWS

Deploy the infrastructure to AWS using Pulumi:

```sh
pulumi up
```
## Teardown

To destroy the provisioned infrastructure:

```sh
pulumi destroy
```

## Directory Structure

- **`index.js`**: The main code defining AWS resources.
- **`Pulumi.yaml`**: Pulumi project definition.
- **`Pulumi.<STACK_NAME>.yaml`**: Stack-specific configuration file.
- **`.gitignore`**: Ignore rules for git.

