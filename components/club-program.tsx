import { Arrow, Asterisk, Geometry } from './icons';
import { FORM_URL } from '@/lib/content';

const tracks = [
  { day: 'Step 01', title: 'Register', text: 'Tell us who you are, what interests you, and what you’d like to explore at MIBC. Use an email address you check regularly so you don’t miss the next step.', note: 'Start your application' },
  { day: 'Step 02', title: 'Book an appointment', text: 'Follow the booking instructions shared by the recruitment team to choose your appointment. Bring your questions, your interests, and a little curiosity—we want to get to know you.', note: 'Watch for booking instructions' },
  { day: 'Step 03', title: 'Check your mail', text: 'Keep an eye on the email address you registered with for your appointment details, recruitment updates, and next steps. Check your spam folder too, just in case.', note: 'Check your inbox and spam folder' },
];
const events = [
  { category: 'Digital marketing', title: 'MarXcellence', text: 'Turn audience insights into a strategy worth pitching. MIBC’s digital marketing case competition challenges university teams to solve business problems, shape campaigns, and present their ideas to industry professionals.', url: 'https://marxcellence.com/' },
  { category: 'International business', title: 'Innovade', text: 'Think across borders. Tackle international business cases, analyze markets, and build practical strategies with your team. Expert-led workshops and competitive presentations connect classroom knowledge with global business decisions.', url: 'https://nsumibc.org/innovade/' },
  { category: 'Industry insights', title: 'Amelior', text: 'Learn from the people doing the work. MIBC’s seminar and skill-development series brings students closer to corporate leaders, with conversations on marketing, sales, international business, and the skills that shape a career.', url: 'https://www.northsouth.edu/newassets/images/5-3342.Dec2019-Jan%202020.pdf' },
  { category: 'Intra-NSU competition', title: 'Intra-Ignite', text: 'Put your marketing instincts to the test on your own campus. This MIBC competition brings NSU undergraduates together to solve real-world marketing challenges through creative ideas, strategic thinking, and persuasive presentations.', url: 'https://nsumibc.org/intra-ignite/' },
];

export function ClubProgram() {
  return <div className="club-program">
    <section className="weekly-tracks section-pad" id="weekly-tracks" aria-labelledby="weekly-title">
      <header className="program-heading"><h2 id="weekly-title">Your next chapter.<br /><em>Three simple steps.</em></h2><div><span className="program-caption">The recruitment journey</span><p>Start with an introduction. Make time for a conversation. Stay connected for what comes next. Here’s how to take your first steps with MIBC.</p></div></header>
      <div className="track-spread" data-motion>{tracks.map((track, i) => <article className={`track-sheet track-${i}`} key={track.day}>
        <div className="track-schedule"><span>{track.day}</span><Asterisk /></div><h3>{track.title}</h3><p>{track.text}</p>{i === 0 ? <a href={FORM_URL} className="track-link">{track.note}<Arrow diagonal /></a> : <p className="track-next">{track.note}</p>}<span className="track-fold" aria-hidden="true" />
      </article>)}</div>
    </section>
    <section className="annual-gatherings section-pad" id="annual-gatherings" aria-labelledby="annual-title">
      <header className="program-heading"><h2 id="annual-title">Big ideas.<br /><em>Real experience.</em></h2><div><span className="program-caption">Four MIBC events</span><p>From digital campaigns to international business cases, MIBC creates space to test your thinking, learn from industry voices, and work on ideas beyond the classroom. Explore four events that bring that ambition to life.</p></div></header>
      <div className="season-collection" data-motion><div className="season-orbit" aria-hidden="true"><Geometry /><span>Ideas into<br /><em>experience.</em></span></div><div className="season-list">{events.map((event, i) => <article className={`season-event season-${i}`} key={event.title}>
        <div className="season-date"><span>{event.category}</span></div><h3>{event.title}</h3><p>{event.text}</p><a className="event-source" href={event.url}>{event.title === 'Amelior' ? 'Read about Amelior (PDF)' : `Explore ${event.title}`}<Arrow diagonal /></a><div className="season-rule" aria-hidden="true"><span /><Asterisk /></div>
      </article>)}</div></div>
    </section>
  </div>;
}
