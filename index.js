const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");

const config = new pulumi.Config();
const availableZonesPromise = aws.getAvailabilityZones();

availableZonesPromise.then(availableZones => {
    const numberOfSubnets = config.getNumber("numberOfSubnets");
    const numberOfAZs = availableZones.names.length;
    const vpcCidrBlock = config.require("vpcCidrBlock");
    
    const calculateSubnets = (vpcCidr, numberOfSubnets) => {
        const [baseIp, subnetSize] = vpcCidr.split('/');
        const subnetBits = Math.ceil(Math.log2(numberOfSubnets));
        const newSubnetSize = parseInt(subnetSize) + subnetBits;
        
        if (newSubnetSize > 30) throw new Error("Subnet size is too small for the number of subnets.");
        
        const ipParts = baseIp.split('.').map(Number);
        const subnets = Array.from({ length: numberOfSubnets }, (_, i) => {
            const subnetIp = [
                ipParts[0],
                ipParts[1],
                i << (8 - subnetBits),
                0
            ].join('.');
            return `${subnetIp}/${newSubnetSize}`;
        });

        return subnets;
    };
    
    const vpc = new aws.ec2.Vpc("myVpc", {
        cidrBlock: vpcCidrBlock,
        enableDnsSupport: true,
        enableDnsHostnames: true,
        tags: {
            Name: "myVpc",
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
        destinationCidrBlock: "0.0.0.0/0",
        gatewayId: igw.id,
    });

    const privateRouteTable = new aws.ec2.RouteTable("privateRouteTable", {
        vpcId: vpc.id,
        tags: {
            Name: "privateRouteTable",
        },
    });

    const subnets = calculateSubnets(vpcCidrBlock, numberOfSubnets);
    
    const resources = {
        vpcId: vpc.id,
        internetGatewayId: igw.id,
        subnets: [],
        routeTables: [publicRouteTable.id, privateRouteTable.id],
    };

    for (let i = 0; i < numberOfSubnets; i++) {
        const az = availableZones.names[i % numberOfAZs];
        const subnetType = i % 2 === 0 ? "public" : "private";
        const subnetCidrBlock = subnets[i];

        const subnet = new aws.ec2.Subnet(`${subnetType}Subnet${i}`, {
            vpcId: vpc.id,
            cidrBlock: subnetCidrBlock,
            availabilityZone: az,
            mapPublicIpOnLaunch: subnetType === "public",
            tags: {
                Name: `${subnetType}Subnet${i}`,
            },
        });

        new aws.ec2.RouteTableAssociation(`${subnetType}RouteTableAssociation${i}`, {
            subnetId: subnet.id,
            routeTableId: subnetType === "public" ? publicRouteTable.id : privateRouteTable.id,
        });

        resources.subnets.push(subnet.id);
    }

    exports.resources = resources;
});

exports.availableZones = availableZonesPromise.then(availableZones => availableZones.names);
