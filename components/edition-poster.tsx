'use client';
import { useState } from 'react';
import { Asterisk, Arrow } from './icons';
const words = [['MAKE', 'YOUR', 'MARK.'], ['THINK', 'A LITTLE', 'BIGGER.'], ['FIND', 'YOUR', 'PEOPLE.']];
export function EditionPoster() {
  const [index, setIndex] = useState(0);
  return <button className={`edition-poster poster-${index}`} onClick={() => setIndex((index + 1) % words.length)} aria-label="Change the poster’s perspective"><span className="poster-top">A fresh perspective, by MIBC <Asterisk /></span><span className="poster-words" key={index}>{words[index].map(word => <span key={word}>{word}</span>)}</span><span className="poster-bottom">Click for a fresh perspective <Arrow diagonal /></span></button>;
}
