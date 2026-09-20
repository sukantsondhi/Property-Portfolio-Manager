targetScope = 'resourceGroup'

resource resourceGroupDeleteLock 'Microsoft.Authorization/locks@2020-05-01' = {
  name: 'property-portfolio-manager-delete-lock'
  properties: {
    level: 'CanNotDelete'
    notes: 'Prevents accidental deletion of portfolio resources. Review data and remove this lock explicitly before intentional deletion.'
  }
}
