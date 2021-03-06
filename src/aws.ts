import * as AWS from 'aws-sdk';

import { info } from './logger';
import { PodType } from './pod';
/** Interface for a breakdown of a region's node count. */
interface IRegionBreakdown {
  /** AWS Region Code identifying the region of this node breakdown */
  id: AWSRegionCode;
  /** Number of regular nodes in the identified region */
  numRegular: number;
  /** Number of partner nodes in the identified region */
  numPartner: number;
}

/** Enum for AWS Region Codes */
enum AWSRegionCode {
  US_EAST = 'us-east-1',
  US_WEST = 'us-west-2',
  CA_CENTRAL = 'ca-central-1',
  SOUTH_AMERICA = 'sa-east-1',
  AUSTRALIA = 'ap-southeast-2',
  KOREA = 'ap-northeast-2',
  JAPAN = 'ap-northeast-1',
  GERMANY = 'eu-central-1',
}

/** Base string used to build specific strings */
const baseName = 'bcp-tn-node';

/** Default keypair string */
const defaultKeyPair = baseName;

/** Default security group string */
const defaultSecurityGroup = `${baseName}-default`;

/** Default image tag string */
const defaultImage = `${baseName}-image`;

/** Tag used for regular nodes */
const regularTag: AWS.EC2.Tag = {
  Key: 'type',
  Value: 'regular',
};

/** Tag used for partner nodes */
const partnerTag: AWS.EC2.Tag = {
  Key: 'type',
  Value: 'partner',
};

/** Tag used for images */
const imageTag: AWS.EC2.Tag = {
  Key: 'category',
  Value: defaultImage,
};

/**
 * Returns an EC2 service object configured with the specified region
 *
 * @param region  Specific region to configure EC2 service object. If undefined, it will use
 * the locally configured region or error out if both are undefined.
 * @returns {AWS.EC2}
 */
const initEC2 = (region?: AWSRegionCode): AWS.EC2 => {
  const ec2 = new AWS.EC2({ region, apiVersion: '2016-11-15' });
  ec2.config.update({
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
  });
  return ec2;
};

/**
 * Creates an EC2 instance
 *
 * @param type  Determines the size of the instance and the tag
 * @param region  Region in which to create an instance
 * @param nodeCount  Number of instances to create
 * @param imageName  AMI to use when creating the instance
 * @param startNode  Should the instance start the node
 * @param callback  Callback containing the created instance
 */
const createEC2Instance = (type: PodType, region: AWSRegionCode, nodeCount: number, imageName: string,
  startNode: boolean, callback: (instance: AWS.EC2.Instance) => void = () => {}) => {
  console.log('[createEC2Instance]');
  const ec2 = initEC2(region);
  const InstanceType = type === PodType.REGULAR_POD ? 't2.medium' : 't2.large';
  const tag = type === PodType.REGULAR_POD ? regularTag : partnerTag;
  let documentName = 'BCP-';
  if (startNode) {
    documentName += 'Start';
    if (type === PodType.REGULAR_POD) {
      documentName += 'Regular';
    }
    else {
      documentName += 'Partner';
    }
  }
  else {
    documentName += 'Update';
  }

  documentName += 'Node';

  const IamInstanceProfile: AWS.EC2.IamInstanceProfile = {
    Arn: 'arn:aws:iam::490668483643:instance-profile/EC2-bcp-tn-regular',
  };

  ec2.describeSecurityGroups((e, d) => {
    if (e) {
      console.log(`[describeSecurityGroups] Error: ${e}`);
    }
    else {
      // console.dir(`[describeSecurityGroups] Success: ${JSON.stringify(d)}`);
      let securityGroup: AWS.EC2.SecurityGroup;
      for (let i = 0; i < d.SecurityGroups!.length; i += 1) {
        const sg = d.SecurityGroups![i];
        if (sg.GroupName === defaultSecurityGroup) {
          securityGroup = sg;
        }
      }
      getImageIdByImageName(ec2, imageName, (ImageId) => {
        const params: AWS.EC2.RunInstancesRequest = {
          IamInstanceProfile,
          ImageId,
          InstanceType,
          KeyName: defaultKeyPair,
          MinCount: nodeCount,
          MaxCount: nodeCount,
          SecurityGroupIds: [securityGroup.GroupId!],
        };

        ec2.runInstances(params, (err, data) => {
          if (err) {
            console.log(`[runInstances] Error: ${err}`);
          }
          else {
            for (let i = 0; i < data.Instances!.length; i += 1) {
              const instance = data.Instances![i];
              const waitForParams: AWS.EC2.DescribeInstancesRequest = {
                InstanceIds: [instance.InstanceId!],
              };
              ec2.waitFor('instanceRunning', waitForParams, (we, wd) => {
                const ssm = new AWS.SSM({ region, apiVersion: '2014-11-06' });
                ssm.config.update({
                  accessKeyId: process.env.ACCESS_KEY_ID,
                  secretAccessKey: process.env.SECRET_ACCESS_KEY,
                });
                const sendCommandParams: AWS.SSM.SendCommandRequest = {
                  DocumentName: documentName,
                  InstanceIds: [instance.InstanceId as string],
                };
                info(region);
                info(`[sendCommandParams]: ${JSON.stringify(sendCommandParams)}`);
                setTimeout(() => {
                  ssm.sendCommand(sendCommandParams, (e, d) => {
                    if (e) {
                      console.log(`[sendCommand] Error: ${e}`);
                    }
                    else {
                      console.log(`${documentName} command sent.`);
                      const tags = {
                        Resources: [instance.InstanceId!],
                        Tags: [tag],
                      };
                      ec2.createTags(tags, (_err, _data) => {
                        if (_err) {
                          console.log(`[createTags] Error: ${_err}`);
                        }
                        else {
                          console.log('Instance tagged');
                          callback(instance);
                        }
                      });
                    }
                  });
                }, 60000);
              });
            }
          }
        });
      });
    }
  });
};
/**
 * Creates a cluster of EC2 instances
 *
 * @param totalNodes  Number of nodes to create
 * @param regions  Array of region codes that the function should spread nodes across
 * @param imageName  AMI to use when creating the instances
 */
const createEC2Cluster = (totalNodes: number, regions: AWSRegionCode[], imageName: string) => {
  regions.length === 0 ? Object.keys(AWSRegionCode).map((key: string) => regions.push(AWSRegionCode[key as any] as AWSRegionCode)) : null;
  const regularNodes = Math.floor(totalNodes * 0.7);
  const partnerNodes = totalNodes - regularNodes;
  const regionBreakdownArray: IRegionBreakdown[] = [];
  const populateRegionBreakdown = (callback: () => void) => {
    for (let i = 0; i < regions.length; i += 1) {
      const region = regions[i];
      const regionBreakdown = {
        id: region,
        numRegular: 0,
        numPartner: 0,
      };
      regionBreakdownArray.push(regionBreakdown);
    }
    callback();
  };

  const distributeNodes = (callback: () => void) => {
    let regularRegionPointer = 0;
    for (let i = 0; i < regularNodes; i += 1) {
      regionBreakdownArray[regularRegionPointer].numRegular += 1;
      regularRegionPointer += 1;
      regularRegionPointer === regionBreakdownArray.length ? regularRegionPointer = 0 : null;
    }

    let partnerRegionPointer = 0;
    for (let i = 0; i < partnerNodes; i += 1) {
      regionBreakdownArray[partnerRegionPointer].numPartner += 1;
      partnerRegionPointer += 1;
      partnerRegionPointer === regionBreakdownArray.length ? partnerRegionPointer = 0 : null;
    }
    callback();
  };

  populateRegionBreakdown(() => distributeNodes(() => {
    for (let i = 0; i < regionBreakdownArray.length; i += 1) {
      const regionBreakdown = regionBreakdownArray[i];
      regionBreakdown.numRegular > 0 && (createEC2Instance(PodType.REGULAR_POD, regionBreakdown.id, regionBreakdown.numRegular, imageName, true));
      regionBreakdown.numPartner > 0 && (createEC2Instance(PodType.PARTNER_POD, regionBreakdown.id, regionBreakdown.numPartner, imageName, true));
    }
  }));
};

/**
 * Returns an array of images in a callback based on the imageTag and EC2 service object provided
 *
 * @param ec2  EC2 service object to use when interacting with AWS api
 * @param imageTag  Tag to use for filtering EC2 images
 * @param callback  Callback containing an array of images matching the imageTag within the specified region
 */
const getImagesByTag = (ec2: AWS.EC2, imageTag: AWS.EC2.Tag, callback: (images: AWS.EC2.Image[] | undefined) => void) => {
  const params: AWS.EC2.DescribeImagesRequest = {
    Filters: [
      {
        Name: `tag:${imageTag.Key as string}`,
        Values: [
          imageTag.Value as string,
        ],
      },
    ],
  };

  ec2.describeImages(params, (err, data) => {
    if (err) {
      console.log(`[describeImages] Error: ${err}`);
    }
    else {
      const images = data.Images;
      callback(images);
    }
  });
};

/**
 * Returns an imageId in a callback based on the imageName and EC2 service object provided
 *
 * @param ec2  EC2 service object to use when interacting with AWS api
 * @param imageName  imageName to use for filtering EC2 images
 * @param callback  Callback containing an imageId that matches the imageName within the specified region
 */
const getImageIdByImageName = (ec2: AWS.EC2, imageName: string, callback: (imageId: string | undefined) => void) => {
  const params: AWS.EC2.DescribeImagesRequest = {
    Filters: [
      {
        Name: 'name',
        Values: [
          imageName,
        ],
      },
    ],
  };
  ec2.describeImages(params, (err, data) => {
    if (data.Images!.length === 0) {
      console.log(`${imageName} not found!`);
    }
    if (err) {
      console.log(err);
    }
    else {
    // console.log(`[describeImages] Images: ${JSON.stringify(data)}`);
      const images = data.Images;
      callback(images![0].ImageId);
    }
  });
};

/**
 * Creates or deletes an unrestrictive security group for all 8 regions. TEMP function
 *
 * @param create  Determines whether the function will create or delete the security groups
 */
const configureSecurityGroups = (create: boolean) => {
  const regions = Object.keys(AWSRegionCode).map((key: string) => AWSRegionCode[key as any]);
  for (let i = 0; i < regions.length; i += 1) {
    const region = regions[i];
    const ec2 = initEC2(region as AWSRegionCode);
    ec2.describeVpcs((err, data) => {
      if (err) {
        console.log(`Cannot get VPCs: ${err}`);
      }
      else {
        for (let k = 0; k < data.Vpcs!.length; k += 1) {
          const vpc = data.Vpcs![k];
          if (create) {
            const createSecurityGroupRequest: AWS.EC2.CreateSecurityGroupRequest = {
              Description: `Default security group for ${defaultKeyPair} instances.`,
              GroupName: defaultSecurityGroup,
              VpcId: vpc.VpcId,
            };

            ec2.createSecurityGroup(createSecurityGroupRequest, (_err, _data) => {
              if (_err) {
                console.log(`[createSecurityGroup] Error: ${_err}`);
              }
              else {
                const inboundParams: AWS.EC2.AuthorizeSecurityGroupIngressRequest = {
                  GroupName: defaultSecurityGroup,
                  IpPermissions: [
                    {
                      IpProtocol: '-1',
                      ToPort: -1,
                      FromPort: -1,
                      IpRanges: [{ CidrIp: '0.0.0.0/0' }],
                    },
                  ],
                };
                ec2.authorizeSecurityGroupIngress(inboundParams, (__err, __data) => {
                  if (__err) {
                    console.log(`[authorizeSecurityGroupIngress] Error: ${__err}`);
                  }
                  else {
                    console.log(`[authorizeSecurityGroupIngress] Success: ${__data}`);
                  }
                });
              }
            });
          }
          else {
            ec2.describeSecurityGroups((_err, _data) => {
              const securityGroups = _data.SecurityGroups;
              for (let j = 0; j < securityGroups!.length; j += 1) {
                const securityGroup = securityGroups![j];
                const deleteSecurityGroupRequest: AWS.EC2.DeleteSecurityGroupRequest = {
                  GroupId: securityGroup.GroupId,
                };
                if (securityGroup.GroupName === defaultSecurityGroup) {
                  ec2.deleteSecurityGroup(deleteSecurityGroupRequest, (e, d) => {
                    if (e) {
                      console.log(`[deleteSecurityGroup] Error: ${e}`);
                    }
                    else {
                      console.log(`[deleteSecurityGroup] Success: ${d}`);
                    }
                  });
                }
              }
            });
          }
        }
      }
    });
  }
};

/**
 * Creates a new image by cloning the most recent image, and pulling / compiling the master branch.
 *
 * @param region  Determines which region the most recent image will come from, and where the new image will be saved
 * @param commitTag  Semantic versioning tag, the new image will use this as it's image name
 * @param callback  Fires when instance used to create the new image is terminated
 */
const createNewImage = (region: AWSRegionCode, commitTag: string, callback: () => void) => {
  const ec2 = initEC2(region);
  getImagesByTag(ec2, imageTag, (images) => {
    images!.sort((a, b) => {
      return Date.parse(b.CreationDate as string) - Date.parse(a.CreationDate as string);
    });
    const mostRecentImage = images![0];
    console.log(`Most Recent Image -- Region: ${region} | Image: ${mostRecentImage.Name}`);
    createEC2Instance(PodType.REGULAR_POD, region, 1, mostRecentImage.Name!, false, (instance: AWS.EC2.Instance) => {
      const waitForParams: AWS.EC2.DescribeInstancesRequest = {
        InstanceIds: [instance.InstanceId!],
      };
      ec2.waitFor('instanceRunning', waitForParams, (e, d) => {
        const params: AWS.EC2.CreateImageRequest = {
          InstanceId: instance.InstanceId as string,
          Name: `${baseName}-${commitTag}`,
        };
        setTimeout(() => {
          ec2.createImage(params, (err, data) => {
            if (err) {
              console.log(`[createImage] Error: ${err}`);
            }
            else {
              console.log(`[createImage] Success: ${JSON.stringify(data)}`);
              const tagParams: AWS.EC2.CreateTagsRequest = {
                Resources: [data.ImageId as string],
                Tags: [imageTag],
              };
              ec2.createTags(tagParams, (tagErr, tagData) => {
                if (err) {
                  console.log(`[createTags] Error: ${tagErr}`);
                }
                else {
                  console.log(`[createTags] Success: ${tagData}`);
                }
              });
              const describeImagesParams: AWS.EC2.DescribeImagesRequest = {
                ImageIds: [data.ImageId as string],
              };
              ec2.waitFor('imageAvailable', describeImagesParams, (_err, _data) => {
                const terminateInstancesParams: AWS.EC2.TerminateInstancesRequest = {
                  InstanceIds: [instance.InstanceId as string],
                };
                ec2.terminateInstances(terminateInstancesParams, (__err, __data) => {
                  if (__err) {
                    console.log(`[terminateInstances] Error: ${__err}`);
                  }
                  else {
                    console.log(`[terminateInstances] Success: ${JSON.stringify(__data)}`);
                    callback();
                  }
                });
              });
            }
          });
        }, 60000);
      });
    });
  });
};

/**
 * Terminates all EC2 instances with the tag 'type:partner' or 'type:regular' and the key 'bcp-tn-node'
 *
 * @param regions  An array of region codes where the instances should be terminated from. If left empty, function will target all 8 regions.
 */
const terminateEC2Cluster = (regions: AWSRegionCode[]): void => {
  info('[terminateEC2Cluster]');
  regions.length === 0 ? Object.keys(AWSRegionCode).map((key: string) => regions.push(AWSRegionCode[key as any] as AWSRegionCode)) : null;
  for (let i = 0; i < regions.length; i += 1) {
    const region = regions[i];
    const ec2 = initEC2(region as AWSRegionCode);
    const params: AWS.EC2.DescribeInstancesRequest = {
      Filters: [
        {
          Name: `tag:${regularTag.Key}` as string,
          Values: [
            regularTag.Value as string,
            partnerTag.Value as string,
          ],
        },
        {
          Name: 'key-name',
          Values: [defaultKeyPair],
        },
        {
          Name: 'instance-state-name',
          Values: ['pending', 'running', 'shutting-down', 'stopping', 'stopped'],
        },
      ],
    };

    ec2.describeInstances(params, (err, data) => {
      if (err) {
        console.log(`[describeInstances] Error: ${err}`);
      }
      else {
        info('[describeInstances]');
        const { Reservations } = data;
        info(`data: ${JSON.stringify(data)}`);
        for (let k = 0; k < Reservations!.length; k += 1) {
          const Reservation = Reservations![k];
          const { Instances } = Reservation;
          const instanceIds = Instances!.map(instance => instance.InstanceId as string);
          const terminateInstancesParams: AWS.EC2.TerminateInstancesRequest = {
            InstanceIds: instanceIds,
          };
          info(`${JSON.stringify(instanceIds)}`);
          info('before terminate instance');
          ec2.terminateInstances(terminateInstancesParams, (_err, _data) => {
            if (_err) {
              console.log(`[terminateInstances] Error: ${_err}`);
            }
            else {
              console.log(`[terminateInstances] Success: ${JSON.stringify(_data)}`);
            }
          });
        }
      }
    });
  }
};

export { AWSRegionCode, createEC2Instance, createEC2Cluster, createNewImage, configureSecurityGroups, terminateEC2Cluster };
