/* The shelf. Edit this file to add what you've watched and listened to.
   Each entry:
     title   (required) what to search for
     year    helps the artwork lookup pick the right one
     artist  music only: makes the album lookup accurate
     rating  0-5, halves allowed (4.5)
     date    when you finished it, YYYY-MM-DD; sorts "Recent" and groups by year
     note    a line or two, shown when the card is opened
     fav     true pins a heart on it
     art     optional image URL, skips the automatic lookup
   Artwork is fetched automatically from Apple's public search and cached in the browser.
   The entries below are PLACEHOLDERS - swap them for your own. */
window.SHELF = {
  movies: [
    { title: "Interstellar", year: 2014, rating: 5, date: "2026-10-02", fav: true, note: "The docking scene still gets me." },
    { title: "Dune: Part Two", year: 2024, rating: 4.5, date: "2026-09-14" },
    { title: "The Social Network", year: 2010, rating: 4.5, date: "2026-08-21" },
    { title: "Ex Machina", year: 2015, rating: 4, date: "2026-07-30" },
    { title: "Blade Runner 2049", year: 2017, rating: 4.5, date: "2026-06-11" },
    { title: "The Martian", year: 2015, rating: 4, date: "2026-05-03" },
    { title: "Oppenheimer", year: 2023, rating: 4, date: "2025-12-19" },
    { title: "Hackers", year: 1995, rating: 3, date: "2025-11-02", note: "Terrible. Perfect." },
    { title: "WALL-E", year: 2008, rating: 5, date: "2025-09-08", fav: true },
    { title: "Arrival", year: 2016, rating: 4.5, date: "2025-07-21" }
  ],
  tv: [
    { title: "Mr. Robot", year: 2015, rating: 5, date: "2026-10-20", fav: true },
    { title: "Severance", year: 2022, rating: 4.5, date: "2026-08-02" },
    { title: "Silicon Valley", year: 2014, rating: 4.5, date: "2026-04-15" },
    { title: "Halt and Catch Fire", year: 2014, rating: 4.5, date: "2026-02-10" },
    { title: "The Bear", year: 2022, rating: 4, date: "2025-10-28" },
    { title: "Black Mirror", year: 2011, rating: 4, date: "2025-06-30" }
  ],
  music: [
    { title: "Random Access Memories", artist: "Daft Punk", year: 2013, rating: 5, date: "2026-10-30", fav: true },
    { title: "In Rainbows", artist: "Radiohead", year: 2007, rating: 5, date: "2026-09-01" },
    { title: "Currents", artist: "Tame Impala", year: 2015, rating: 4.5, date: "2026-07-12" },
    { title: "Discovery", artist: "Daft Punk", year: 2001, rating: 4.5, date: "2026-03-18" },
    { title: "Blonde", artist: "Frank Ocean", year: 2016, rating: 4.5, date: "2025-12-01" },
    { title: "The Social Network (Soundtrack)", artist: "Trent Reznor & Atticus Ross", year: 2010, rating: 4, date: "2025-08-09" },
    { title: "Tron: Legacy", artist: "Daft Punk", year: 2010, rating: 4, date: "2025-05-22" },
    { title: "AM", artist: "Arctic Monkeys", year: 2013, rating: 4, date: "2025-03-14" }
  ]
};
