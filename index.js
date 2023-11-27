const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");
const gcp = require("@pulumi/gcp");
const mysql = require("@pulumi/aws/rds");
const route53 = require("@pulumi/aws/route53");
const iam = require("@pulumi/aws/iam");
const sns = require("@pulumi/aws/sns");

const config = new pulumi.Config();
const vpcCidrBlock = config.require("vpcCidrBlock");
const destinationCidrBlock = config.require("destinationCidrBlock");
const amiId = config.require("amiId");

const currentRegion = aws.getRegion();

const engine = config.require("engine");
const instanceClass = config.require("instanceClass");
const dbName = config.require("dbName");
const identifier = config.require("identifier");
const username = config.require("username");
const dbPassword = config.requireSecret("dbPassword");

const instanceType = config.require("instanceType");
const keyName = config.require("keyName");

const domainName = config.require("domainName");
const hostedZoneId = config.require("hostedZoneId");
const applicationPort = config.require("applicationPort");

const mailgunApiKey = config.requireSecret("mailgunApiKey");
const mailgunDomain = config.require("mailgunDomain");

const gcpConfig = new pulumi.Config("gcp"); 
const gcpProjectId = gcpConfig.require("project");

const availableZonesPromise = aws.getAvailabilityZones({ region: currentRegion });

availableZonesPromise.then(availableZones => {
    const numberOfAZs = availableZones.names.length;

    const vpc = new aws.ec2.Vpc("myVpc", {
        cidrBlock: vpcCidrBlock,
        enableDnsSupport: true,
        enableDnsHostnames: true,
        tags: {
            Name: "myVpc",
        },
    });

    const loadBalancerSecurityGroup = new aws.ec2.SecurityGroup("loadBalancerSecurityGroup", {
        vpcId: vpc.id,
        description: "Security group for the load balancer",
        ingress: [
            { protocol: "tcp", fromPort: 80, toPort: 80, cidrBlocks: ["0.0.0.0/0"] },
            { protocol: "tcp", fromPort: 443, toPort: 443, cidrBlocks: ["0.0.0.0/0"] },
        ],
        egress: [
            { protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"], ipv6CidrBlocks: ["::/0"], },
        ],
    });

    const appSecurityGroup = new aws.ec2.SecurityGroup("appSecurityGroup", {
        vpcId: vpc.id,
        description: "Security group for application servers",
        ingress: [
            { protocol: "tcp", fromPort: 22, toPort: 22, cidrBlocks: ["0.0.0.0/0"] },
            { protocol: "tcp", fromPort: applicationPort, toPort: applicationPort, securityGroups: [loadBalancerSecurityGroup.id] },
        ],
        egress: [
            { protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"], ipv6CidrBlocks: ["::/0"], },
        ],
        tags: {
            Name: "applicationSecurityGroup",
        },
    });

    const igw = new aws.ec2.InternetGateway("myIgw", {
        vpcId: vpc.id,
        tags: {
            Name: "myIgw",
        },
    });

    const publicRouteTable = new aws.ec2.RouteTable("publicRouteTable", {
        vpcId: vpc.id,
        tags: {
            Name: "publicRouteTable",
        },
    });

    const publicRoute = new aws.ec2.Route("publicRoute", {
        routeTableId: publicRouteTable.id,
        destinationCidrBlock: destinationCidrBlock,
        gatewayId: igw.id,
    });

    const privateRouteTable = new aws.ec2.RouteTable("privateRouteTable", {
        vpcId: vpc.id,
        tags: {
            Name: "privateRouteTable",
        },
    });

    const resources = {
        vpcId: vpc.id,
        internetGatewayId: igw.id,
        publicSubnets: [],
        privateSubnets: [],
        routeTables: [publicRouteTable.id, privateRouteTable.id],
    };

    let thirdOctet = 1;

    for (let i = 0; i < numberOfAZs; i++) {
        const az = availableZones.names[i];

        ['public', 'private'].forEach(type => {
            const subnetCidrBlock = `10.0.${thirdOctet}.0/24`;

            const subnet = new aws.ec2.Subnet(`${type}Subnet${thirdOctet}`, {
                vpcId: vpc.id,
                cidrBlock: subnetCidrBlock,
                availabilityZone: az,
                mapPublicIpOnLaunch: type === "public",
                tags: {
                    Name: `${type}Subnet${thirdOctet}`,
                },
            });

            new aws.ec2.RouteTableAssociation(`${type}RouteTableAssociation${thirdOctet}`, {
                subnetId: subnet.id,
                routeTableId: type === "public" ? publicRouteTable.id : privateRouteTable.id,
            });

            if (type === "public") {
                resources.publicSubnets.push(subnet.id);
            } else {
                resources.privateSubnets.push(subnet.id);
            }

            thirdOctet += 2;
        });
    }

    const dbSecurityGroup = new aws.ec2.SecurityGroup("dbSecurityGroup", {
        vpcId: vpc.id,
        ingress: [
            { protocol: "tcp", fromPort: 3306, toPort: 3306, securityGroups: [appSecurityGroup.id] },
        ],
        tags: {
            Name: "databaseSecurityGroup",
        },
    });

    const dbParameterGroup = new mysql.ParameterGroup("db-parameter-group", {
        family: "mariadb10.6",
        parameters: [{ name: "character_set_client", value: "utf8" }],
    });

    const dbSubnetGroup = new aws.rds.SubnetGroup("db-subnet-group", {
        subnetIds: resources.privateSubnets,
    });

    const rdsInstance = new aws.rds.Instance("myRdsInstance", {
        engine: engine,
        instanceClass: instanceClass,
        dbName: dbName,
        identifier: identifier,
        username: username,
        password: dbPassword,
        dbSubnetGroupName: dbSubnetGroup.name,
        vpcSecurityGroupIds: [dbSecurityGroup.id],
        skipFinalSnapshot: true,
        parameterGroupName: dbParameterGroup.name,
        allocatedStorage: 5,
        multiAz: false,
        publiclyAccessible: false,
    });

    const cloudWatchRole = new iam.Role("cloudWatchRole", {
        assumeRolePolicy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Action: "sts:AssumeRole",
                Effect: "Allow",
                Principal: {
                    Service: "ec2.amazonaws.com",
                },
            }],
        }),
        path: "/",
    });

    const cloudWatchPolicyAttachment = new iam.RolePolicyAttachment("cloudWatchPolicyAttachment", {
        role: cloudWatchRole.name,
        policyArn: "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy",
    });

    const mySnsTopic = new sns.Topic("mySnsTopic", {
        displayName: "My SNS Topic for Lambda Notifications",
    });

    const snsPublishPolicy = new aws.iam.Policy("snsPublishPolicy", {
        description: "Policy to allow publishing to the SNS topic",
        policy: {
            Version: "2012-10-17",
            Statement: [
                {
                    Effect: "Allow",
                    Action: "sns:Publish",
                    Resource: mySnsTopic.arn,
                },
            ],
        },
    });

    const snsPublishPolicyAttachment = new aws.iam.PolicyAttachment("snsPublishPolicyAttachment", {
        policyArn: snsPublishPolicy.arn,
        roles: [cloudWatchRole.name],
    });

    const cloudWatchInstanceProfile = new iam.InstanceProfile("cloudWatchInstanceProfile", {
        role: cloudWatchRole.name,
    });

    const bucket = new gcp.storage.Bucket("myBucket", {
        name: "csye6225-pavancloud-bucket",
        location: "US",
        forceDestroy: true,
    });

    const serviceAccount = new gcp.serviceaccount.Account("myServiceAccount", {
        accountId: "my-service-account",
        displayName: "My Service Account",
    });

    const iamBinding = new gcp.projects.IAMBinding("serviceAccountStorageAdmin", {
        project: gcpProjectId,
        members: [pulumi.interpolate`serviceAccount:${serviceAccount.email}`],
        role: "roles/storage.objectAdmin", 
    });
    

    const serviceAccountKeys = new gcp.serviceaccount.Key("myServiceAccountKeys", {
        serviceAccountId: serviceAccount.email,
    });

    const dynamoTable = new aws.dynamodb.Table("myDynamoTable", {
        attributes: [
            { name: "email", type: "S" },
        ],
        hashKey: "email",
        billingMode: "PAY_PER_REQUEST",
    });

    const lambdaRole = new aws.iam.Role("lambdaRole", {
        assumeRolePolicy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Action: "sts:AssumeRole",
                Effect: "Allow",
                Principal: {
                    Service: "lambda.amazonaws.com",
                },
            }],
        }),
    });

    const lambdaPolicy = new aws.iam.Policy("lambdaPolicy", {
        policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Action: [
                    "sns:Publish",
                    "sns:Subscribe",
                    "dynamodb:*",
                    "s3:*",
                ],
                Effect: "Allow",
                Resource: "*",
            }],
        }),
    });

    const lambdaPolicyAttachment = new aws.iam.RolePolicyAttachment("lambdaPolicyAttachment", {
        role: lambdaRole.name,
        policyArn: lambdaPolicy.arn,
    });

    const lambdaFunction = new aws.lambda.Function("myLambdaFunction", {
        runtime: aws.lambda.Runtime.NodeJS18dX,
        role: lambdaRole.arn,
        handler: "index.handler",
        code: new pulumi.asset.AssetArchive({
            ".": new pulumi.asset.FileArchive("../serverless") // Path to your Lambda function code
        }),
        timeout: 30,
        environment: {
            variables: {
                GOOGLE_CLOUD_BUCKET: bucket.name,
                MAILGUN_API_KEY: mailgunApiKey,
                MAILGUN_DOMAIN: mailgunDomain,
                DYNAMODB_TABLE_NAME: dynamoTable.name,
                GCP_SERVICE_ACCOUNT_KEY: serviceAccountKeys.privateKey.apply(key => key),
            },
        },
    });

    const lambdaPermission = new aws.lambda.Permission("snsLambdaPermission", {
        action: "lambda:InvokeFunction",
        function: lambdaFunction.arn,
        principal: "sns.amazonaws.com",
        sourceArn: mySnsTopic.arn,
    });

    const lambdaSubscription = new aws.sns.TopicSubscription("myLambdaSubscription", {
        topic: mySnsTopic.arn,
        protocol: "lambda",
        endpoint: lambdaFunction.arn,
    });


    const aws_region = availableZones.names[0].slice(0, -1);

    const userData = pulumi.all([rdsInstance.endpoint, rdsInstance.port, rdsInstance.dbName, rdsInstance.username, rdsInstance.password, aws_region, mySnsTopic.arn]).apply(([endpoint, port, dbName, username, password, region, snsTopicArn]) => {
        const [hostname] = endpoint.split(":");
        return `#!/bin/bash
    echo "DB_HOST=${hostname}" >> /opt/AssignmentsAPI/AssignmentsAPI/.env
    echo "DB_PORT=${port}" >> /opt/AssignmentsAPI/AssignmentsAPI/.env
    echo "DB_USER=${username}" >> /opt/AssignmentsAPI/AssignmentsAPI/.env
    echo "DB_PASSWORD=${password}" >> /opt/AssignmentsAPI/AssignmentsAPI/.env
    echo "DB_DATABASE=${dbName}" >> /opt/AssignmentsAPI/AssignmentsAPI/.env
    echo "AWS_REGION=${region}" >> /opt/AssignmentsAPI/AssignmentsAPI/.env
    echo "SNS_TOPIC_ARN=${snsTopicArn}" >> /opt/AssignmentsAPI/AssignmentsAPI/.env
    sudo systemctl daemon-reload
    sudo systemctl enable assignments-api
    sudo systemctl start assignments-api
    sudo systemctl restart assignments-api
    sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -c file:/opt/aws/amazon-cloudwatch-agent.json -s
    `;
    });

    const userDataEncoded = userData.apply(ud => Buffer.from(ud).toString('base64'));

    const launchTemplate = new aws.ec2.LaunchTemplate("appLaunchTemplate", {
        imageId: amiId,
        instanceType: instanceType,
        keyName: keyName,
        userData: userDataEncoded,
        iamInstanceProfile: {
            name: cloudWatchInstanceProfile.name,
        },
        networkInterfaces: [{
            associatePublicIpAddress: true,
            deleteOnTermination: true,
            deviceIndex: 0,
            securityGroups: [appSecurityGroup.id],
        }],
    });

    const targetGroup = new aws.lb.TargetGroup("appTargetGroup", {
        port: applicationPort,
        protocol: "HTTP",
        vpcId: vpc.id,
        targetType: "instance",
        healthCheck: {
            enabled: true,
            interval: 30,
            path: "/healthz/",
            port: "8080",
            protocol: "HTTP",
            healthyThreshold: 2,
            unhealthyThreshold: 2,
            timeout: 5,
        },
    });

    const autoScalingGroup = new aws.autoscaling.Group("autoScalingGroup", {
        launchTemplate: {
            id: launchTemplate.id,
            version: "$Latest",
        },
        minSize: 1,
        maxSize: 3,
        desiredCapacity: 1,
        vpcZoneIdentifiers: resources.publicSubnets,
        cooldown: 60,
        targetGroupArns: [targetGroup.arn],
        tags: [
            { key: "Name", value: "AutoScalingGroup", propagateAtLaunch: true },
        ],
    });

    const scaleUpPolicy = new aws.autoscaling.Policy("scaleUpPolicy", {
        autoscalingGroupName: autoScalingGroup,
        adjustmentType: "ChangeInCapacity",
        scalingAdjustment: 1,
        cooldown: 60,
        metricAggregationType: "Average",
    });

    const scaleDownPolicy = new aws.autoscaling.Policy("scaleDownPolicy", {
        autoscalingGroupName: autoScalingGroup,
        adjustmentType: "ChangeInCapacity",
        scalingAdjustment: -1,
        cooldown: 60,
        metricAggregationType: "Average",
    });

    const scaleUpAlarm = new aws.cloudwatch.MetricAlarm("scaleUpAlarm", {
        comparisonOperator: "GreaterThanThreshold",
        evaluationPeriods: 1,
        metricName: "CPUUtilization",
        namespace: "AWS/EC2",
        period: 60,
        statistic: "Average",
        threshold: 5,
        alarmActions: [scaleUpPolicy.arn],
        dimensions: {
            AutoScalingGroupName: autoScalingGroup.name,
        },
    });

    const scaleDownAlarm = new aws.cloudwatch.MetricAlarm("scaleDownAlarm", {
        comparisonOperator: "LessThanThreshold",
        evaluationPeriods: 1,
        metricName: "CPUUtilization",
        namespace: "AWS/EC2",
        period: 60,
        statistic: "Average",
        threshold: 3,
        alarmActions: [scaleDownPolicy.arn],
        dimensions: {
            AutoScalingGroupName: autoScalingGroup.name,
        },
    });

    const appLoadBalancer = new aws.lb.LoadBalancer("appLoadBalancer", {
        internal: false,
        loadBalancerType: "application",
        securityGroups: [loadBalancerSecurityGroup.id],
        subnets: resources.publicSubnets,
    });

    const listener = new aws.lb.Listener("appListener", {
        loadBalancerArn: appLoadBalancer.arn,
        port: 80,
        defaultActions: [{
            type: "forward",
            targetGroupArn: targetGroup.arn,
        }],
    });

    const appAliasRecord = new route53.Record("appAliasRecord", {
        zoneId: hostedZoneId,
        name: domainName,
        type: "A",
        aliases: [{
            name: appLoadBalancer.dnsName,
            zoneId: appLoadBalancer.zoneId,
            evaluateTargetHealth: true,
        }],
    });

});
