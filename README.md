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
pulumi config set <CONFIG_VARIABLE_NAME> <CONFIG_VARIABLE_VALUE>
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


## Importing an SSL Certificate into AWS Certificate Manager

If you have an existing SSL certificate that you want to use with your AWS infrastructure, you can import it into AWS Certificate Manager (ACM). Follow these steps:

### Requirements

- A valid SSL certificate, a private key, and an optional certificate chain file (in PEM format).
- AWS CLI installed and configured with the necessary permissions.

### Importing the Certificate

1. **Locate Certificate Files**: Ensure you have the following files available:
   - Certificate file (e.g., `certificate.pem`)
   - Private key file (e.g., `private_key.pem`)
   - Certificate chain file (optional, e.g., `certificate_chain.pem`)

2. **Run the AWS CLI Command**: Use the following AWS CLI command to import the certificate:

   ```sh
   aws acm import-certificate \
       --certificate fileb://path/to/certificate.pem \
       --private-key fileb://path/to/private_key.pem \
       [--certificate-chain fileb://path/to/certificate_chain.pem]
    ```
Replace path/to/certificate.pem, path/to/private_key.pem, and path/to/certificate_chain.pem with the actual paths to your certificate files. If you don't have a certificate chain file, omit that part of the command.