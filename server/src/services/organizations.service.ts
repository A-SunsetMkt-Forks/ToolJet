import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { GroupPermission } from 'src/entities/group_permission.entity';
import { Organization } from 'src/entities/organization.entity';
import { SSOConfigs } from 'src/entities/sso_config.entity';
import { User } from 'src/entities/user.entity';
import { cleanObject } from 'src/helpers/utils.helper';
import { createQueryBuilder, Repository } from 'typeorm';
import { OrganizationUser } from '../entities/organization_user.entity';
import { GroupPermissionsService } from './group_permissions.service';
import { OrganizationUsersService } from './organization_users.service';
import { UsersService } from './users.service';

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectRepository(Organization)
    private organizationsRepository: Repository<Organization>,
    @InjectRepository(SSOConfigs)
    private ssoConfigRepository: Repository<SSOConfigs>,
    @InjectRepository(OrganizationUser)
    private organizationUsersRepository: Repository<OrganizationUser>,
    @InjectRepository(GroupPermission)
    private groupPermissionsRepository: Repository<GroupPermission>,
    private usersService: UsersService,
    private organizationUserService: OrganizationUsersService,
    private groupPermissionService: GroupPermissionsService,
    private configService: ConfigService
  ) {}

  async create(name: string, user?: User): Promise<Organization> {
    const organization = await this.organizationsRepository.save(
      this.organizationsRepository.create({
        ssoConfigs: [
          {
            sso: 'form',
            enabled: this.configService.get<string>('DISABLE_PASSWORD_LOGIN') === 'true' ? false : true,
          },
        ],
        name,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    );

    const createdGroupPermissions = await this.createDefaultGroupPermissionsForOrganization(organization);

    if (user) {
      await this.organizationUserService.create(user, organization, false);

      for (const groupPermission of createdGroupPermissions) {
        await this.groupPermissionService.createUserGroupPermission(user.id, groupPermission.id);
      }
    }

    return organization;
  }

  async get(id: string): Promise<Organization> {
    return await this.organizationsRepository.findOne({ where: { id }, relations: ['ssoConfigs'] });
  }

  async getSingleOrganization(): Promise<Organization> {
    return await this.organizationsRepository.findOne();
  }

  async createDefaultGroupPermissionsForOrganization(organization: Organization) {
    const defaultGroups = ['all_users', 'admin'];
    const createdGroupPermissions = [];

    for (const group of defaultGroups) {
      const isAdmin = group === 'admin';
      const groupPermission = this.groupPermissionsRepository.create({
        organizationId: organization.id,
        group: group,
        appCreate: isAdmin,
        appDelete: isAdmin,
        folderCreate: isAdmin,
      });
      await this.groupPermissionsRepository.save(groupPermission);
      createdGroupPermissions.push(groupPermission);
    }

    return createdGroupPermissions;
  }

  async fetchUsers(user: any): Promise<OrganizationUser[]> {
    const organizationUsers = await this.organizationUsersRepository.find({
      where: { organizationId: user.organizationId },
      relations: ['user'],
    });

    // serialize
    const serializedUsers = [];
    for (const orgUser of organizationUsers) {
      const serializedUser = {
        email: orgUser.user.email,
        firstName: orgUser.user.firstName,
        lastName: orgUser.user.lastName,
        name: `${orgUser.user.firstName} ${orgUser.user.lastName}`,
        id: orgUser.id,
        role: orgUser.role,
        status: orgUser.status,
      };

      if ((await this.usersService.hasGroup(user, 'admin')) && orgUser.user.invitationToken)
        serializedUser['invitationToken'] = orgUser.user.invitationToken;

      serializedUsers.push(serializedUser);
    }

    return serializedUsers;
  }

  async fetchOrganisations(user: any): Promise<Organization[]> {
    return await createQueryBuilder(Organization, 'organization')
      .innerJoin(
        'organization.organizationUsers',
        'organisation_users',
        'organisation_users.status IN(:...statusList)',
        {
          statusList: ['active'],
        }
      )
      .andWhere('organisation_users.userId = :userId', {
        userId: user.id,
      })
      .orderBy('name', 'ASC')
      .getMany();
  }

  async findOrganizationSupportsFormLogin(user: any): Promise<Organization[]> {
    return await createQueryBuilder(Organization, 'organization')
      .innerJoin('organization.ssoConfigs', 'organisation_sso', 'organisation_sso.sso = :form', {
        form: 'form',
      })
      .innerJoin(
        'organization.organizationUsers',
        'organisation_users',
        'organisation_users.status IN(:...statusList)',
        {
          statusList: ['active'],
        }
      )
      .where('organisation_sso.enabled = :enabled', {
        enabled: true,
      })
      .andWhere('organisation_users.userId = :userId', {
        userId: user.id,
      })
      .orderBy('name', 'ASC')
      .getMany();
  }

  async getSSOConfigs(organizationId: string, sso: string): Promise<Organization> {
    return await createQueryBuilder(Organization, 'organization')
      .leftJoinAndSelect('organization.ssoConfigs', 'organisation_sso', 'organisation_sso.sso = :sso', {
        sso,
      })
      .andWhere('organization.id = :organizationId', {
        organizationId,
      })
      .getOne();
  }

  async fetchOrganisationDetails(
    organizationId: string,
    statusList?: Array<boolean>,
    isHideSensitiveData?: boolean
  ): Promise<Organization> {
    const result = await createQueryBuilder(Organization, 'organization')
      .innerJoinAndSelect(
        'organization.ssoConfigs',
        'organisation_sso',
        'organisation_sso.enabled IN (:...statusList)',
        {
          statusList: statusList || [true, false], // Return enabled and disabled sso if status list not passed
        }
      )
      .andWhere('organization.id = :organizationId', {
        organizationId,
      })
      .getOne();

    if (!isHideSensitiveData) {
      return result;
    }
    return this.hideSSOSensitiveData(result?.ssoConfigs);
  }

  private hideSSOSensitiveData(ssoConfigs: SSOConfigs[]): any {
    const configs = {};
    if (ssoConfigs?.length > 0) {
      for (const config of ssoConfigs) {
        delete config.configs['clientSecret'];
        delete config['id'];
        delete config['organizationId'];
        delete config['createdAt'];
        delete config['updatedAt'];

        switch (config.sso) {
          case 'git':
            configs['git'] = {
              ...config,
            };
            break;
          case 'google':
            configs['google'] = {
              ...config,
            };
            break;
          case 'form':
            configs['form'] = {
              ...config,
            };
            break;
          default:
            break;
        }
      }
    }
    return configs;
  }

  async updateOrganization(organizationId: string, params) {
    const { name, domain, autoAssign, enableSignUp } = params;

    const updateableParams = {
      name,
      domain,
      autoAssign,
      enableSignUp,
    };

    // removing keys with undefined values
    cleanObject(updateableParams);

    return await this.organizationsRepository.update(organizationId, updateableParams);
  }

  async updateOrganizationConfigs(organizationId: string, params: any) {
    const { type, configs, enabled } = params;

    if (!(type && ['git', 'google', 'form'].includes(type))) {
      throw new BadRequestException();
    }
    const organization: Organization = await this.getSSOConfigs(organizationId, type);

    if (organization?.ssoConfigs?.length > 0) {
      const ssoConfigs: SSOConfigs = organization.ssoConfigs[0];

      const updateableParams = {
        configs,
        enabled,
      };

      // removing keys with undefined values
      cleanObject(updateableParams);
      return await this.ssoConfigRepository.update(ssoConfigs.id, updateableParams);
    } else {
      const newSSOConfigs = this.ssoConfigRepository.create({
        organization,
        sso: type,
        configs,
        enabled: !!enabled,
      });
      return await this.ssoConfigRepository.save(newSSOConfigs);
    }
  }

  async getConfigs(id: string): Promise<SSOConfigs> {
    return await this.ssoConfigRepository.findOne({ where: { id, enabled: true }, relations: ['organization'] });
  }
}
