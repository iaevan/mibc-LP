export const FORM_URL = 'https://forms.google.com';

export const concepts = [
  { number: '01', name: 'Signal', path: '/' },
  { number: '02', name: 'Edition', path: '/edition/' },
  { number: '03', name: 'Orbit', path: '/orbit/' },
  { number: '04', name: 'Studio', path: '/studio/' },
  { number: '05', name: 'Invitation', path: '/invitation/' },
] as const;

export const faqs = [
  { question: 'Do I need to study marketing to join?', answer: 'Curiosity about ideas, people, and business is a great place to start. Explore the possibilities here, and check the official recruitment form for the club’s eligibility requirements.' },
  { question: 'What if I have no club experience?', answer: 'A first step is still a step. Bring curiosity, a willingness to contribute, and something you would love to learn. Your application is a chance to introduce the person behind the résumé.' },
  { question: 'What would I get involved in?', answer: 'Think campaign ideas, creative storytelling, event planning, business conversations, and the teamwork that brings them together. Explore the disciplines on this page and imagine where you would like to contribute.' },
  { question: 'How do I apply?', answer: 'Start with the application button at the end of this page. Introduce yourself, tell us what interests you, and follow MIBC’s official recruitment updates for the next steps.' },
];

export const disciplines = [
  { title: 'Brand & storytelling', short: 'Give ideas a voice.', text: 'Find the insight. Shape the message. Turn a good idea into something people remember.', tags: 'Strategy · Copy · Campaigns' },
  { title: 'Creative & design', short: 'Make people look twice.', text: 'Build visual stories, capture a moment, and make every detail say something worth hearing.', tags: 'Design · Photography · Content' },
  { title: 'People & partnerships', short: 'Make the right connections.', text: 'Start conversations, bring different perspectives together, and turn a shared ambition into a real collaboration.', tags: 'Communication · Outreach · Collaboration' },
  { title: 'Events & experiences', short: 'Bring the idea to life.', text: 'Connect the moving parts, think on your feet, and help create experiences people want to be part of.', tags: 'Planning · Production · Teamwork' },
];
