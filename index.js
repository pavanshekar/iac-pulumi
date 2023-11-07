const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");
const mysql = require("@pulumi/aws/rds");
const route53 = require("@pulumi/aws/route53");
const iam = require("@pulumi/aws/iam");

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
const volumeSize = config.require("volumeSize");
const volumeType = config.require("volumeType");

const domainName = config.require("domainName");
const hostedZoneId = config.require("hostedZoneId");
const applicationPort = config.require("applicationPort");

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

    const appSecurityGroup = new aws.ec2.SecurityGroup("appSecurityGroup", {
        vpcId: vpc.id,
        description: "Security group for application servers",
        ingress: [
            { protocol: "tcp", fromPort: 22, toPort: 22, cidrBlocks: ["0.0.0.0/0"] },
            { protocol: "tcp", fromPort: 80, toPort: 80, cidrBlocks: ["0.0.0.0/0"] },
            { protocol: "tcp", fromPort: 443, toPort: 443, cidrBlocks: ["0.0.0.0/0"] },
            { protocol: "tcp", fromPort: 8080, toPort: 8080, cidrBlocks: ["0.0.0.0/0"] },
        ],
        egress: [
            { protocol: "tcp", fromPort: 3306, toPort: 3306, cidrBlocks: ["0.0.0.0/0"] },
            { protocol: "tcp", fromPort: 443, toPort: 443, cidrBlocks: ["0.0.0.0/0"] },
            { protocol: "udp", fromPort: 8125, toPort: 8125, cidrBlocks: ["0.0.0.0/0"] },
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

    const cloudWatchInstanceProfile = new iam.InstanceProfile("cloudWatchInstanceProfile", {
        role: cloudWatchRole.name,
    });

    const userData = pulumi.all([rdsInstance.endpoint, rdsInstance.port, rdsInstance.dbName, rdsInstance.username, rdsInstance.password]).apply(([endpoint, port, dbName, username, password]) => {
        const [hostname] = endpoint.split(":");
        return `#!/bin/bash
    echo "DB_HOST=${hostname}" >> /opt/AssignmentsAPI/AssignmentsAPI/.env
    echo "DB_PORT=${port}" >> /opt/AssignmentsAPI/AssignmentsAPI/.env
    echo "DB_USER=${username}" >> /opt/AssignmentsAPI/AssignmentsAPI/.env
    echo "DB_PASSWORD=${password}" >> /opt/AssignmentsAPI/AssignmentsAPI/.env
    echo "DB_DATABASE=${dbName}" >> /opt/AssignmentsAPI/AssignmentsAPI/.env
    sudo systemctl daemon-reload
    sudo systemctl enable assignments-api
    sudo systemctl start assignments-api
    sudo systemctl restart assignments-api
    sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -c file:/opt/aws/amazon-cloudwatch-agent.json -s
    `;
    });
    const ec2Instance = new aws.ec2.Instance("appInstance", {
        ami: amiId,
        instanceType: instanceType,
        keyName: keyName,
        vpcSecurityGroupIds: [appSecurityGroup.id],
        subnetId: resources.publicSubnets[0],
        userData: userData,
        rootBlockDevice: {
            volumeSize: volumeSize,
            volumeType: volumeType,
        },
        iamInstanceProfile: cloudWatchInstanceProfile.name,
        disableApiTermination: false,
        tags: {
            Name: "ApplicationInstance",
        },
    });

    const aRecord = new route53.Record("applicationARecord", {
        zoneId: hostedZoneId,
        name: domainName,
        type: "A",
        ttl: 300,
        records: [ec2Instance.publicIp],
    });

    exports.vpcDetails = {
        id: vpc.id,
        cidrBlock: vpc.cidrBlock,
    };

    exports.publicSubnetDetails = resources.publicSubnets.map((id, index) => ({
        [`publicSubnet${index + 1}`]: id,
    }));

    exports.privateSubnetDetails = resources.privateSubnets.map((id, index) => ({
        [`privateSubnet${index + 1}`]: id,
    }));

    exports.routeTableDetails = {
        publicRouteTableId: publicRouteTable.id,
        privateRouteTableId: privateRouteTable.id,
    };

    exports.securityGroupDetails = {
        appSecurityGroupId: appSecurityGroup.id,
        dbSecurityGroupId: dbSecurityGroup.id,
    };

    exports.dbSubnetGroupDetails = {
        dbSubnetGroupName: dbSubnetGroup.name,
        subnetIds: dbSubnetGroup.subnetIds,
    };

    exports.dbInstanceDetails = {
        id: rdsInstance.id,
        endpoint: rdsInstance.endpoint,
        port: rdsInstance.port,
        username: rdsInstance.username,
        password: rdsInstance.password,
    };

    exports.ec2InstanceDetails = {
        id: ec2Instance.id,
        publicIp: ec2Instance.publicIp,
        privateIp: ec2Instance.privateIp,
    };

    exports.hostedZoneDetails = {
        domainName: domainName,
        hostedZoneId: hostedZoneId,
    };
});