const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");

const config = new pulumi.Config();
const vpcCidrBlock = config.require("vpcCidrBlock");
const destinationCidrBlock = config.require("destinationCidrBlock");
const amiId = config.require("amiId");

const currentRegion = aws.getRegion(); 

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
        subnets: [],
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

            resources.subnets.push(subnet.id);
            thirdOctet += 2; 
        });
    }

    const ec2Instance = new aws.ec2.Instance("appInstance", {
        ami: amiId, 
        instanceType: "t2.micro",
        keyName: "key-pair",
        vpcSecurityGroupIds: [appSecurityGroup.id],
        subnetId: resources.subnets[0],
        rootBlockDevice: {
            volumeSize: 25,
            volumeType: "gp2",
        },
        disableApiTermination: false, 
        tags: {
            Name: "ApplicationInstance",
        },
    });
    

    exports.ec2InstanceDetails = {
        id: ec2Instance.id,
        publicIp: ec2Instance.publicIp,
        privateIp: ec2Instance.privateIp,
        instanceType: ec2Instance.instanceType
    };

    exports.resources = resources;
});

exports.availableZones = availableZonesPromise.then(availableZones => availableZones.names);
