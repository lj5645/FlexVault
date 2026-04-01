export interface RecommendedStorageLink {
  name: string;
  capacity: string;
}

export interface RecommendedProviderBase {
  id: 'infinicloud' | 'koofr' | 'pcloud';
  name: string;
  capacity: string;
  protocol: 'webdav' | 's3';
  signupUrl: string;
  hasAffiliateLink?: boolean;
}

export interface InfinicloudProvider extends RecommendedProviderBase {
  id: 'infinicloud';
  referralCode: string;
}

export interface KoofrProvider extends RecommendedProviderBase {
  id: 'koofr';
  passwordUrl: string;
  storageUrl: string;
  linkedStorages: RecommendedStorageLink[];
}

export interface PcloudProvider extends RecommendedProviderBase {
  id: 'pcloud';
}

export type RecommendedProvider = InfinicloudProvider | KoofrProvider | PcloudProvider;

export const RECOMMENDED_PROVIDERS: RecommendedProvider[] = [
  {
    id: 'infinicloud',
    name: 'InfiniCLOUD',
    capacity: '25G',
    protocol: 'webdav',
    signupUrl: 'https://infini-cloud.net/en/',
    referralCode: '2HC5E',
  },
  {
    id: 'koofr',
    name: 'Koofr',
    capacity: '10G',
    protocol: 'webdav',
    signupUrl: 'https://app.koofr.net/signup',
    passwordUrl: 'https://app.koofr.net/app/admin/preferences/password',
    storageUrl: 'https://app.koofr.net/app/storage/',
    linkedStorages: [
      { name: 'Google Drive', capacity: '15G' },
      { name: 'OneDrive', capacity: '5G' },
      { name: 'Dropbox', capacity: '2G' },
    ],
  },
  {
    id: 'pcloud',
    name: 'pCloud',
    capacity: '10G',
    protocol: 'webdav',
    signupUrl: 'https://u.pcloud.com/#/register?invite=GITx7ZvEU1N7',
    hasAffiliateLink: true,
  },
];

export function hasLinkedStorages(provider: RecommendedProvider): provider is KoofrProvider {
  return provider.id === 'koofr';
}
