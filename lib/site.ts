export const SITE_URL = 'https://nsumibc.online';
export const CLUB_NAME = 'Marketing & International Business Club';
export const SITE_NAME = 'MIBC Recruitment 10.0';

export const organization = {
  '@type': 'Organization',
  '@id': `${SITE_URL}/#organization`,
  name: CLUB_NAME,
  alternateName: 'NSU MIBC',
  url: `${SITE_URL}/`,
  logo: { '@type': 'ImageObject', url: `${SITE_URL}/images/mibc-logo.webp`, width: 384, height: 275 },
  parentOrganization: { '@type': 'CollegeOrUniversity', name: 'North South University', url: 'https://www.northsouth.edu/' },
  sameAs: [
    'https://www.facebook.com/NSUMIBC',
    'https://www.instagram.com/nsumibc/',
    'https://www.linkedin.com/company/nsumibc/',
  ],
};

export const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    organization,
    { '@type': 'WebSite', '@id': `${SITE_URL}/#website`, name: SITE_NAME, alternateName: 'NSU MIBC', url: `${SITE_URL}/`, inLanguage: 'en', publisher: { '@id': organization['@id'] } },
    { '@type': 'WebPage', '@id': `${SITE_URL}/#webpage`, url: `${SITE_URL}/`, name: `${SITE_NAME} | North South University`, isPartOf: { '@id': `${SITE_URL}/#website` }, about: { '@id': organization['@id'] }, inLanguage: 'en' },
  ],
};
