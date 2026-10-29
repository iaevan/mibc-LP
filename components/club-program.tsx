import { Asterisk, Geometry } from './icons';


const tracks = [
  { title: 'Register', text: 'Complete the registration form and take your first step towards becoming part of MIBC.' },
  { title: 'Schedule Your Round 1 Appointment', text: 'To secure your interview slot, please find our booth at the lower plaza.' },
  { title: 'Stay Tuned', text: 'Keep an eye on your email and spam folder for Round 1 result and further instructions.' },
];
const events = [
  { category: 'Digital marketing', title: 'MarXcellence', text: 'The nation’s premier and largest international business case competition.', url: 'https://marxcellence.com/' },
  { category: 'International business', title: 'Innovade', text: 'The country’s inaugural international enterprise-focused business competition.', url: 'https://nsumibc.org/innovade/' },
  { category: 'Industry insights', title: 'Amelior', text: 'Empowering aspiring professionals to bridge the gap between academic theory and industry expectations through expert-led insights.', url: 'https://www.northsouth.edu/newassets/images/5-3342.Dec2019-Jan%202020.pdf' },
  { category: 'Intra-NSU competition', title: 'Intra-Ignite', text: 'Fostering a culture of innovation and creative enterprise within North South University.', url: 'https://nsumibc.org/intra-ignite/' },
];

export function ClubProgram() {
  return <div className="club-program">
    <section className="weekly-tracks section-pad" id="weekly-tracks" aria-labelledby="weekly-title">
      <header className="roadmap-heading" data-reveal><span className="program-caption">The recruitment journey</span><h2 id="weekly-title">Your next chapter.<br /><em>Three simple steps.</em></h2></header>
      <ol className="recruitment-roadmap">{tracks.map((track, i) => <li className="roadmap-step" key={track.title}>
        <span className="roadmap-number" aria-hidden="true">0{i + 1}</span><div className="roadmap-copy" data-reveal data-reveal-delay={i * 60}><h3>{track.title}</h3><p>{track.text}</p></div>
      </li>)}</ol>
      <div className="roadmap-action"><p>TAKE THE LEAP.</p></div>
    </section>
    <section className="annual-gatherings section-pad" id="annual-gatherings" aria-labelledby="annual-title">
      <header className="program-heading events-intro" data-reveal><span className="program-caption">Four MIBC events</span><h2 id="annual-title">Big ideas.<br /><em>Real experience.</em></h2><p>From digital campaigns to international business cases, MIBC creates space to test your thinking, learn from industry voices, and work on ideas beyond the classroom. Explore four events that bring that ambition to life.</p></header>
      <div className="season-collection" data-motion><div className="season-orbit"><span className="orbit-geometry" aria-hidden="true"><Geometry /></span><span>Your next chapter<br /><em>starts here.</em></span></div><div className="season-list">{events.map((event, i) => <article className={`season-event season-${i}`} key={event.title} data-reveal>
        <div className="season-date"><span>{event.category}</span></div><h3>{event.title}</h3><p>{event.text}</p><div className="season-rule" aria-hidden="true"><span /><Asterisk /></div>
      </article>)}</div></div>
    </section>
  </div>;
}
