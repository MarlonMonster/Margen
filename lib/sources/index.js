'use strict';
const gutenberg = require('./gutenberg');
const wikipedia = require('./wikipedia');
const librivox = require('./librivox');

/** Sites that have no usable feed. They are listed in the app as links so they are easy to find. */
const LINKS = [
  { name: 'ManyThings: sentence pairs with audio', url: 'https://www.manythings.org/anki/', note: 'The same Tatoeba sentences Margen already uses for practice sets, as downloads for flashcard apps.' },
  { name: 'Tatoeba', url: 'https://tatoeba.org', note: 'Add your own sentences or listen to recordings for many of them. CC BY 2.0 FR.' },
  { name: 'StoryWeaver', url: 'https://storyweaver.org.in', note: 'Illustrated children’s stories by reading level, CC BY 4.0. Its data feed does not include story text, so read these on the site.' },
  { name: 'Free Kids Books', url: 'https://www.freekidsbooks.org/', note: 'Children’s books to read or download, with a Spanish section. Licences differ per book.' },
  { name: 'Instituto Cervantes: Lecturas paso a paso', url: 'https://cvc.cervantes.es/aula/lecturas/', note: 'Official graded readings (inicial, intermedio, avanzado). Copyrighted, for your own study.' },
  { name: 'Lingua.com', url: 'https://lingua.com/es/espanol/lectura/', note: 'Free reading texts from A1 to B2 on a commercial site.' },
  { name: 'Bilinguis and Alba Learning', url: '', note: 'Classic stories with Spanish and English side by side. Search for them by name. Licences not checked.' },
];

function createRegistry({ fetch, imgDir, sentences, bases = {} } = {}) {
  const gut = gutenberg.create({ fetch, imgDir, base: bases.gutendex });
  const wiki = wikipedia.create({ fetch, imgDir, base: bases.wikipedia, baseEn: bases.wikipediaEn });
  const lv = librivox.create({ fetch, gutenberg: gut, base: bases.librivox });
  const list = [gut, wiki, lv];
  return {
    list,
    get: (id) => list.find((s) => s.id === id),
    meta: () => ({
      practice: { levels: sentences.LEVELS },
      sources: list.map(({ id, name, kind, homepage, description, placeholder }) => ({ id, name, kind, homepage, description, placeholder })),
      links: LINKS,
    }),
  };
}

module.exports = { createRegistry, LINKS };
