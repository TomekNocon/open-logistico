import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['customs_documents.*'],
    employee: ['customs_documents.view', 'customs_documents.manage'],
  },
}

export default setup
