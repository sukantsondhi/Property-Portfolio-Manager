import { DefaultAzureCredential, ManagedIdentityCredential, type TokenCredential } from '@azure/identity';

let credential: TokenCredential | undefined;
export function assertProductionConfiguration() {
  if ((process.env.NODE_ENV === 'production' || process.env.WEBSITE_INSTANCE_ID) && (process.env.LOCAL_AUTH === 'true' || process.env.DATA_BACKEND === 'memory'))
    throw new Error('Local authentication and memory storage must not be enabled in Azure or production.');
}
export function getCredential(): TokenCredential {
  assertProductionConfiguration();
  credential ??= process.env.NODE_ENV === 'development'
    ? new DefaultAzureCredential()
    : process.env.AZURE_CLIENT_ID
      ? new ManagedIdentityCredential({ clientId: process.env.AZURE_CLIENT_ID })
      : new ManagedIdentityCredential();
  return credential;
}
