import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  CustomsDeclaration,
  CustomsUploadedDocument,
  CustomsLineItem,
  CustomsDiscrepancy,
} from './data/entities'

export function register(container: AppContainer) {
  container.register({
    CustomsDeclaration: asValue(CustomsDeclaration),
    CustomsUploadedDocument: asValue(CustomsUploadedDocument),
    CustomsLineItem: asValue(CustomsLineItem),
    CustomsDiscrepancy: asValue(CustomsDiscrepancy),
  })
}
