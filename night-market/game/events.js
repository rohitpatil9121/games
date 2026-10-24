import { REGULARS, VENDOR } from "./data.js";
import { rnd, chance, vendorById, stallById, stallAt, hiredVendors, worker, neighbours, relation, setRelation, addMod, removeVendor, has } from "./sim.js";

/**
 * NIGHT MARKET — closing events. After every night exactly one of these is offered, chosen from the ones
 * whose `find` says they apply to what actually happened. Each choice changes cash, reputation, a
 * vendor's mood or wage, a relationship, or adds a modifier for the coming nights.
 *
 * An event is { priority, repeat?, who, title, text, find, choices }:
 *   find(state)            → a small JSON context (ids only) if the event applies tonight, else null
 *   repeat                 → minimum nights before it can come up again (omit for once per campaign)
 *   choices[i].cost        → dollars; the choice is disabled when the player can't afford it
 *   choices[i].apply(s, c) → makes the change and returns the sentence shown afterwards
 * @module game/events
 */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const V = (s, id) => vendorById(s, id);
const mood = (v, d) => { v.mood = clamp(v.mood + d, 0, 100); };
const rep = (s, d) => { s.rep = clamp(s.rep + d, 0, 100); };
const avgStars = (pv) => (pv && pv.served ? pv.stars / pv.served : 0);
const working = (s) => hiredVendors(s).filter((v) => s.stats.perVendor[v.id]?.worked);
/** A vendor walks out. If they left bitter they set up a competing stall at the end of the street. */
function quit(s, v, bitter) { removeVendor(s, v); if (bitter) s.rivalStall = true; }

export const EVENTS = {
    // ------------------------------------------------------------------ the regulars
    student: {
        priority: 90, who: "student", title: () => "The broke student",
        find: (s) => (s.stats.studentSeen && s.policy.student == null ? {} : null),
        text: () => "Bao walked the whole street tonight counting coins, then left without eating. He has three dollars. He'll be back tomorrow, and the night after.",
        choices: [
            { label: "Feed him for free", detail: () => "One free meal a night. Costs you the ingredients.", apply: (s) => { s.policy.student = "free"; return "\"Really?\" From tomorrow Bao eats on the house."; } },
            { label: "Three-dollar special", detail: () => "He pays $3 for anything.", apply: (s) => { s.policy.student = "discount"; return "A three-dollar special, just for him. He looks relieved."; } },
            { label: "Sorry, kid", detail: () => "He stops coming. Reputation −2.", apply: (s) => { s.policy.student = "away"; rep(s, -2); return "He nods and doesn't come back. A few people noticed."; } },
        ],
    },
    studentPayoff: {
        priority: 86, who: "student", title: () => "Bao got the job",
        find: (s) => (s.flags.studentFed >= 3 && !s.flags.studentPaid ? {} : null),
        text: () => "Bao turns up in a shirt with a collar. He got the internship, and he says he only made it through the month because of your street. He's holding an envelope.",
        choices: [
            { label: "Take the envelope", detail: () => "+$90", apply: (s) => { s.flags.studentPaid = true; s.cash += 90; return "Ninety dollars, in small notes. He counted it twice."; } },
            { label: "\"Keep it. Tell your friends.\"", detail: () => "Reputation +8, and 15% more customers for 3 nights.", apply: (s) => { s.flags.studentPaid = true; rep(s, 8); addMod(s, "arrivals", 1.15, 3, "Bao's friends"); return "By morning half the university has heard about the street."; } },
        ],
    },
    critic: {
        priority: 85, who: "critic", title: (s, c) => (c.stars >= 4 ? "A glowing review" : "A brutal review"),
        find: (s) => (s.stats.critic != null && (s.stats.critic >= 4 || s.stats.critic <= 2) ? { stars: s.stats.critic, v: s.stats.criticVendor } : null),
        text: (s, c) => {
            const v = c.v != null ? V(s, c.v) : null, name = v ? v.name : "your vendor";
            if (c.stars >= 4) return `That was Ms. Vane from the city paper, and ${name} cooked for her. The review is already online: ${c.stars} stars. Tonight's reputation gain was doubled.`;
            return c.stars === 0 ? "That was Ms. Vane from the city paper, and she left the queue without being served. The review is two angry paragraphs. Tonight's reputation loss was doubled."
                : `That was Ms. Vane from the city paper. ${name} served her, and she was not impressed: ${c.stars} stars. Tonight's reputation loss was doubled.`;
        },
        choices: [
            { label: "Frame it on every stall", cost: 30, show: (s, c) => c.stars >= 4, detail: () => "All stalls 8% more appealing, for good.", apply: (s) => { s.appealBonus += 0.08; return "Laminated, framed, and hung where every queue can read it."; } },
            { label: "Share the credit", show: (s, c) => c.stars >= 4, detail: () => "Every vendor's mood +8.", apply: (s) => { for (const v of hiredVendors(s)) mood(v, 8); return "You read it aloud at closing. Everyone goes home taller."; } },
            { label: "Apologise publicly", cost: 40, show: (s, c) => c.stars <= 2, detail: () => "Free samples tomorrow. Reputation +6.", apply: (s) => { rep(s, 6); return "A handwritten sign and a tray of free samples. People respect it."; } },
            { label: "Blame the vendor", show: (s, c) => c.stars <= 2 && c.v != null && !!V(s, c.v)?.hired, detail: (s, c) => `Reputation +2. ${V(s, c.v).name}'s mood −20.`, apply: (s, c) => { rep(s, 2); mood(V(s, c.v), -20); return `${V(s, c.v).name} hears about it from a customer. They are not happy.`; } },
            { label: "Say nothing", detail: () => "No further effect.", apply: () => "Tomorrow there'll be a different story in the paper." },
        ],
    },
    landlordAngry: {
        priority: 80, who: "landlord", repeat: 3, title: () => "The landlord was kept waiting",
        find: (s) => (s.stats.landlord && (s.stats.landlord.angry || s.stats.landlord.wait > 11) ? { wait: Math.round(s.stats.landlord.wait) } : null),
        text: (s, c) => `Mr. Okafor stood in a queue for ${c.wait} seconds tonight. He has decided that a street this busy can afford more rent.`,
        choices: [
            { label: "Pay a goodwill fee", cost: 45, detail: () => "Rent stays on its current track.", apply: () => "He pockets it and says no more about it." },
            { label: "Accept the increase", detail: () => "Rent rises $6 faster every night.", apply: (s) => { s.rentStep += 6; return "The new figures arrive on a sheet of paper, already signed."; } },
            { label: "Argue", detail: () => "Even odds: nothing happens, or it rises $10 faster.", apply: (s) => { if (chance(s, 0.5)) return "You talk him round. He leaves grumbling but the rent holds."; s.rentStep += 10; return "That went badly. He adds a little extra for the attitude."; } },
        ],
    },
    landlordPleased: {
        priority: 70, who: "landlord", repeat: 3, title: () => "The landlord ate well",
        find: (s) => (s.stats.landlord && !s.stats.landlord.angry && s.stats.landlord.wait <= 11 && s.stats.landlord.stars >= 4 ? {} : null),
        text: () => "Mr. Okafor was served quickly and finished the bowl. He is in an unusually good mood and asks, almost kindly, if there's anything you need.",
        choices: [
            { label: "A rent freeze", detail: () => "Rent doesn't rise for the next 2 nights.", apply: (s) => { s.rentFreeze = 2; return "\"Two nights. Don't tell the others.\""; } },
            { label: "A cheaper extension", show: (s) => s.slots < 10, detail: () => "The next street extension costs half.", apply: (s) => { s.flags.extendDiscount = true; return "He waves a hand at the empty lots. Half price, this once."; } },
            { label: "Nothing, thank you", detail: () => "He tells people you're good tenants. Reputation +4.", apply: (s) => { rep(s, 4); return "He seems surprised, and mentions you at his club."; } },
        ],
    },
    poach: {
        priority: 88, who: "rival", title: () => "An offer from Dario Finch",
        find: (s) => { const v = s.flags.scouted != null ? V(s, s.flags.scouted) : null; return s.night >= 5 && v && v.hired && !s.flags.poachDone ? { v: v.id } : null; },
        text: (s, c) => `The man in sunglasses was Dario Finch, who runs the market two streets over. He has offered ${V(s, c.v).name} a job at better pay, and ${V(s, c.v).name} has come to tell you before deciding.`,
        choices: [
            { label: "Match the offer", detail: (s, c) => `${V(s, c.v).name}'s wage +$12 a night. They stay.`, apply: (s, c) => { s.flags.poachDone = true; const v = V(s, c.v); v.wage += 12; mood(v, 10); v.lastRaise = s.night; return `${v.name} stays, at $${v.wage} a night.`; } },
            { label: "Appeal to loyalty", detail: (s, c) => `Works if their mood is 62 or more (now ${Math.round(V(s, c.v).mood)}).`, apply: (s, c) => { s.flags.poachDone = true; const v = V(s, c.v); if (v.mood >= 62) { mood(v, 5); return `${v.name} laughs. "I wasn't really going to go."`; } quit(s, v, true); return `${v.name} takes the job. Finch opens a stall at the end of your street with them behind the counter.`; } },
            { label: "Let them go", detail: () => "They leave and open a competing stall: 14% fewer customers.", apply: (s, c) => { s.flags.poachDone = true; const v = V(s, c.v); quit(s, v, true); return `${v.name} shakes your hand and leaves. Finch's stall opens at the end of the street.`; } },
        ],
    },
    nurse: {
        priority: 55, who: "nurse", title: () => "Imani brings the ward",
        find: (s) => (s.flags.nurseServed >= 3 && !s.flags.nurseDone ? {} : null),
        text: () => "Imani has eaten here on three breaks now and tipped every time. Tonight she asks if you'd consider feeding the rest of the night shift.",
        choices: [
            { label: "Start a late-night special", detail: () => "Six extra customers late every night, for good.", apply: (s) => { s.flags.nurseDone = true; s.flags.lateCrowd = true; return "From tomorrow a small crowd in scrubs arrives just before closing."; } },
            { label: "Take a catering order", detail: () => "+$100 now.", apply: (s) => { s.flags.nurseDone = true; s.cash += 100; return "Forty boxes, paid in advance by the hospital."; } },
        ],
    },
    kid: {
        priority: 45, who: "kid", title: () => "Pip and Biscuit",
        find: (s) => (s.stats.kid && !s.flags.kidDone ? {} : null),
        text: () => "A kid called Pip stopped on your street tonight with a dog called Biscuit, and a small crowd stopped with them. The stalls near them had their busiest ten seconds of the night.",
        choices: [
            { label: "Give Biscuit a treat", cost: 5, detail: () => "They come back every night.", apply: (s) => { s.flags.kidDone = true; s.flags.dogFriend = true; return "Biscuit now considers your street part of the route."; } },
            { label: "Put up a dog-friendly sign", cost: 25, detail: () => "They come back every night. Reputation +4.", apply: (s) => { s.flags.kidDone = true; s.flags.dogFriend = true; rep(s, 4); return "Pip reads the sign out loud to the dog."; } },
            { label: "Shoo them off", detail: () => "They stop coming. Reputation −3.", apply: (s) => { s.flags.kidDone = true; s.flags.dogShooed = true; rep(s, -3); return "Several customers watched you do it."; } },
        ],
    },

    // ------------------------------------------------------------------ the staff
    quitThreat: {
        priority: 82, repeat: 2, who: (s, c) => c.v, title: (s, c) => `${V(s, c.v).name} wants out`,
        find: (s) => { const v = hiredVendors(s).filter((x) => x.mood < VENDOR.quitMood).sort((a, b) => a.mood - b.mood)[0]; return v ? { v: v.id } : null; },
        text: (s, c) => `${V(s, c.v).name} has had enough. Mood is down to ${Math.round(V(s, c.v).mood)}, and they've started packing their knives before closing.`,
        choices: [
            { label: "Offer a raise", detail: (s, c) => `Wage +$10 a night. Mood back to 55.`, apply: (s, c) => { const v = V(s, c.v); v.wage += 10; v.mood = 55; v.lastRaise = s.night; return `${v.name} unpacks. $${v.wage} a night from now on.`; } },
            { label: "Talk it through", detail: (s) => `${Math.round((0.3 + s.rep / 200) * 100)}% chance they stay. Better odds with a good reputation.`, apply: (s, c) => { const v = V(s, c.v); if (chance(s, 0.3 + s.rep / 200)) { mood(v, 24); return `An hour on an upturned crate, and ${v.name} decides to give it another week.`; } quit(s, v, v.mood < 15); return `${v.name} listens politely, then leaves.`; } },
            { label: "Let them go", detail: () => "They leave tonight.", apply: (s, c) => { const v = V(s, c.v); quit(s, v, v.mood < 15); return `${v.name} is gone before the lanterns are down.`; } },
        ],
    },
    rivalFight: {
        priority: 75, repeat: 2, who: (s, c) => c.a, title: (s, c) => `${V(s, c.a).name} and ${V(s, c.b).name}`,
        find: (s) => { const sc = s.stats.scenes[0]; return sc && V(s, sc.a)?.hired && V(s, sc.b)?.hired ? { a: sc.a, b: sc.b, n: s.stats.scenes.length } : null; },
        text: (s, c) => `${V(s, c.a).name} and ${V(s, c.b).name} stopped serving to argue ${c.n === 1 ? "once" : c.n + " times"} tonight, in front of both queues. Each wants you to say the other started it.`,
        choices: [
            { label: (s, c) => `Side with ${V(s, c.a).name}`, detail: (s, c) => `${V(s, c.a).name} mood +8, ${V(s, c.b).name} mood −14.`, apply: (s, c) => { mood(V(s, c.a), 8); mood(V(s, c.b), -14); return `${V(s, c.b).name} doesn't say a word for the rest of the night.`; } },
            { label: (s, c) => `Side with ${V(s, c.b).name}`, detail: (s, c) => `${V(s, c.b).name} mood +8, ${V(s, c.a).name} mood −14.`, apply: (s, c) => { mood(V(s, c.b), 8); mood(V(s, c.a), -14); return `${V(s, c.a).name} doesn't say a word for the rest of the night.`; } },
            { label: "Buy them both a drink", cost: 20, detail: () => "Even odds they make peace for good.", apply: (s, c) => { if (chance(s, 0.5)) { setRelation(s, c.a, c.b, null); return "Two bubble teas later they are complaining about you instead. The feud is over."; } mood(V(s, c.a), -4); mood(V(s, c.b), -4); return "One of the drinks ends up thrown. Nothing has changed."; } },
        ],
    },
    exhausted: {
        priority: 65, repeat: 2, who: (s, c) => c.v, title: (s, c) => `${V(s, c.v).name} is running on empty`,
        find: (s) => { const v = working(s).filter((x) => s.stats.perVendor[x.id].minEnergy <= 3).sort((a, b) => a.mood - b.mood)[0]; return v ? { v: v.id } : null; },
        text: (s, c) => `${V(s, c.v).name} served the last hour on nothing at all and is asleep on a stool before you've counted the till.`,
        choices: [
            { label: "Give them tomorrow off, paid", detail: () => "They don't work tomorrow. Mood +18.", apply: (s, c) => { const v = V(s, c.v); v.off = true; mood(v, 18); return `${v.name} will be back the night after. Find cover for their stall.`; } },
            { label: "Energy drinks on the house", cost: 15, detail: () => "Mood +7.", apply: (s, c) => { mood(V(s, c.v), 7); return "It isn't rest, but it's something."; } },
            { label: "\"Toughen up\"", detail: () => "Mood −12.", apply: (s, c) => { mood(V(s, c.v), -12); return `${V(s, c.v).name} gives you a long look.`; } },
        ],
    },
    raise: {
        priority: 60, repeat: 3, who: (s, c) => c.v, title: (s, c) => `${V(s, c.v).name} asks for a raise`,
        find: (s) => {
            const v = working(s).filter((x) => { const pv = s.stats.perVendor[x.id]; return pv.served >= 12 && avgStars(pv) >= 3.7 && x.nights >= 2 && s.night - x.lastRaise >= 3; })
                .sort((a, b) => s.stats.perVendor[b.id].served - s.stats.perVendor[a.id].served)[0];
            return v ? { v: v.id, served: s.stats.perVendor[v.id].served } : null;
        },
        text: (s, c) => `${V(s, c.v).name} served ${c.served} people tonight and knows it. They'd like their pay to reflect that.`,
        choices: [
            { label: "Give the raise", detail: (s, c) => `Wage +$8 a night (to $${V(s, c.v).wage + 8}). Mood +15.`, apply: (s, c) => { const v = V(s, c.v); v.wage += 8; mood(v, 15); v.lastRaise = s.night; return `${v.name} is on $${v.wage} a night and smiling.`; } },
            { label: "A one-off bonus", cost: 30, detail: () => "Mood +8.", apply: (s, c) => { const v = V(s, c.v); mood(v, 8); v.lastRaise = s.night; return `${v.name} takes the thirty dollars. It'll come up again.`; } },
            { label: "Not now", detail: () => "Mood −14.", apply: (s, c) => { const v = V(s, c.v); mood(v, -14); v.lastRaise = s.night; return `${v.name} nods slowly.`; } },
        ],
    },
    friendship: {
        priority: 50, repeat: 2, who: (s, c) => c.a, title: (s, c) => `${V(s, c.a).name} and ${V(s, c.b).name} get on`,
        find: (s) => {
            for (const stall of s.stalls.slice().sort((x, y) => x.slot - y.slot)) {
                const right = stallAt(s, stall.slot + 1), a = worker(s, stall), b = right && worker(s, right);
                if (!a || !b || relation(s, a.id, b.id)) continue;
                if (avgStars(s.stats.perVendor[a.id]) >= 3.4 && avgStars(s.stats.perVendor[b.id]) >= 3.4) return { a: a.id, b: b.id };
            }
            return null;
        },
        text: (s, c) => `${V(s, c.a).name} and ${V(s, c.b).name} spent the quiet moments passing food over the gap between their stalls. They're still talking while they pack up.`,
        choices: [
            { label: "Buy the first round", cost: 15, detail: () => "They become friends: both serve 16% faster side by side.", apply: (s, c) => { setRelation(s, c.a, c.b, "friend"); return "By the second round they're planning a shared menu."; } },
            { label: "Leave them to it", detail: () => "40% chance they become friends anyway.", apply: (s, c) => { if (chance(s, 0.4)) { setRelation(s, c.a, c.b, "friend"); return "They didn't need your help. Friends."; } return "They say goodnight and go their separate ways."; } },
        ],
    },
    mentor: {
        priority: 48, repeat: 3, who: (s, c) => c.m, title: (s, c) => `${V(s, c.p).name} levelled up`,
        find: (s) => {
            for (const id of s.stats.levelUps) {
                const p = V(s, id), stall = p && p.stallId != null ? stallById(s, p.stallId) : null;
                const m = stall && neighbours(s, stall).find((n) => has(n.vendor, "mentor"));
                if (m) return { p: id, m: m.vendor.id };
            }
            return null;
        },
        text: (s, c) => `${V(s, c.p).name} reached skill ${V(s, c.p).skill} tonight, and says it's down to ${V(s, c.m).name} next door shouting advice across the gap all week.`,
        choices: [
            { label: (s, c) => `Promote ${V(s, c.m).name}`, detail: (s, c) => `${V(s, c.m).name}: wage +$6, mood +14. ${V(s, c.p).name}: mood +6.`, apply: (s, c) => { const m = V(s, c.m); m.wage += 6; mood(m, 14); mood(V(s, c.p), 6); return `${m.name} is now "head of training", which mostly means a nicer apron.`; } },
            { label: "A quiet thank-you", detail: (s, c) => `${V(s, c.m).name}: mood +5.`, apply: (s, c) => { mood(V(s, c.m), 5); return "A nod and a free drink. It lands."; } },
        ],
    },

    // ------------------------------------------------------------------ the street
    tour: {
        priority: 58, repeat: 2, who: "guide", title: (s, c) => (c.good ? "The tour loved it" : "The tour left hungry"),
        find: (s) => { const t = s.stats.tour; return t && (t.angry >= 3 || (t.happy >= 5 && !s.flags.tourNightly)) ? { good: t.angry < 3, happy: t.happy, angry: t.angry } : null; },
        text: (s, c) => (c.good
            ? `Mrs. Park's group of seven came through tonight and ${c.happy} of them left four stars or better. She would like to make your street a fixed stop.`
            : `Mrs. Park brought seven people down your street tonight and ${c.angry} of them gave up or found nothing. She is deciding what to tell tomorrow's group.`),
        choices: [
            { label: "Join her nightly route", show: (s, c) => c.good, detail: () => "The tour comes every night from now on: seven customers at once.", apply: (s) => { s.flags.tourNightly = true; return "Your street is on the laminated map now."; } },
            { label: "Take a finder's fee instead", show: (s, c) => c.good, detail: () => "+$70.", apply: (s) => { s.cash += 70; return "She pays in an envelope with the tour company's logo on it."; } },
            { label: "Send apologies and vouchers", cost: 35, show: (s, c) => !c.good, detail: () => "Reputation +3.", apply: (s) => { rep(s, 3); return "Seven vouchers, hand-delivered to the hotel."; } },
            { label: "Shrug it off", show: (s, c) => !c.good, detail: () => "Reputation −4.", apply: (s) => { rep(s, -4); return "Tomorrow's group hears about it on the bus."; } },
        ],
    },
    festival: {
        priority: 40, repeat: 5, title: () => "Lantern festival tomorrow",
        find: (s) => (s.night % 10 === 9 ? {} : null),
        text: () => "Tomorrow is the lantern festival and the whole district will be out walking. The streets that dress up for it get the crowds.",
        choices: [
            { label: "Hang lanterns", cost: 40, detail: () => "30% more customers tomorrow instead of 12%. Reputation +2.", apply: (s) => { addMod(s, "arrivals", 1.16, 1, "Your own lanterns"); rep(s, 2); return "Two hundred paper lanterns, strung by midnight."; } },
            { label: "Do nothing special", detail: () => "12% more customers tomorrow, as on every street.", apply: () => { return "Some of the crowd will wander through anyway."; } },
        ],
    },
    inspector: {
        priority: 78, repeat: 2, who: "inspector", title: (s, c) => (c.n ? "The inspector's report" : "A clean inspection"),
        // the report is kept until it has been dealt with, so a busier night's story can't bury it
        find: (s) => (s.flags.inspection ? { ...s.flags.inspection } : null),
        text: (s, c) => {
            if (!c.n) return `Inspector Dube's report is in. He stood at ${c.checked} of your stalls and found nothing to write down, and he has brought the certificate himself.`;
            const v = c.v != null ? V(s, c.v) : null;
            return `Inspector Dube's report is in. He watched ${c.checked} of your stalls and wrote up ${c.n === 1 ? "one of them" : c.n + " of them"}${v ? `, starting with ${v.name}: ${c.why}` : ""}. The fine is $${30 * c.n}.`;
        },
        choices: [
            { label: "Frame the certificate", cost: 20, show: (s, c) => !c.n, detail: () => "All stalls 4% more appealing, for good.", apply: (s) => { s.flags.inspection = null; s.appealBonus += 0.04; return "It hangs where every queue can read it."; } },
            { label: "Pin it by the gate", show: (s, c) => !c.n, detail: () => "Reputation +3.", apply: (s) => { s.flags.inspection = null; rep(s, 3); return "People do read these things."; } },
            { label: "Pay the fine", show: (s, c) => c.n > 0, detail: (s, c) => `−$${30 * c.n}.`, apply: (s, c) => { s.flags.inspection = null; s.cash -= 30 * c.n; return "Paid in full, receipt stapled to the report."; } },
            { label: "Contest it", show: (s, c) => c.n > 0, detail: () => "Even odds: it is dropped, or the fine stands and reputation −4.", apply: (s, c) => { s.flags.inspection = null; if (chance(s, 0.5)) return "He reads your letter twice and withdraws the report."; s.cash -= 30 * c.n; rep(s, -4); return "The fine stands, and now there is a notice on the wall."; } },
            { label: "Promise retraining", show: (s, c) => c.n > 0, detail: () => "No fine. Every vendor's mood −6.", apply: (s) => { s.flags.inspection = null; for (const v of hiredVendors(s)) mood(v, -6); return "Two hours of hygiene videos after closing. Nobody is speaking to you."; } },
        ],
    },
    supplier: {
        priority: 28, jitter: 12, title: () => "A supplier's offer",
        find: (s) => (s.night >= 2 && s.stalls.length ? {} : null),
        text: () => "A wholesaler with a van full of produce is doing the rounds and wants your business.",
        choices: [
            { label: "Buy in bulk", cost: 60, detail: () => "Ingredients cost 30% less for 3 nights.", apply: (s) => { addMod(s, "cost", 0.7, 3, "Bulk ingredients"); return "The van is unloaded into every spare corner."; } },
            { label: "Go premium", detail: () => "Ingredients cost 25% more, reviews improve, for 3 nights.", apply: (s) => { addMod(s, "cost", 1.25, 3, "Premium ingredients"); addMod(s, "sat", 0.1, 3, "Premium ingredients"); return "The good stuff. Customers will taste the difference."; } },
            { label: "No thanks", detail: () => "No effect.", apply: () => "He shrugs and drives on." },
        ],
    },
    rain: {
        priority: 26, jitter: 12, repeat: 4, title: () => "Rain on the way",
        find: (s) => (s.night >= 2 && !s.flags.awnings && !s.forecast && s.stalls.length ? {} : null),
        text: () => "The forecast for tomorrow night is heavy rain. Wet streets keep people at home.",
        choices: [
            { label: "Buy awnings", cost: 45, detail: () => "Rain never costs you customers again.", apply: (s) => { s.flags.awnings = true; s.forecast = "rain"; return "Striped canvas over the whole walkway. Let it rain."; } },
            { label: "Risk it", detail: () => "25% fewer customers tomorrow, and on every wet night after.", apply: (s) => { s.forecast = "rain"; return "You'll find out tomorrow."; } },
        ],
    },
    musician: {
        priority: 24, jitter: 12, title: () => "A street musician",
        find: (s) => (s.night >= 2 && s.stalls.length ? {} : null),
        text: () => "A woman with an erhu and an amplifier asks if she can set up at the end of your street.",
        choices: [
            { label: "Hire her for two nights", cost: 40, detail: () => "Queues lose patience 25% more slowly for 2 nights.", apply: (s) => { addMod(s, "patience", 0.75, 2, "Street musician"); return "People in the queues stop checking their watches."; } },
            { label: "Let her busk for free", detail: () => "Even odds: a good night, or she drives people off.", apply: (s) => { if (chance(s, 0.5)) { addMod(s, "patience", 0.8, 1, "Street musician"); rep(s, 2); return "She's good. People stay to listen."; } addMod(s, "arrivals", 0.92, 1, "One song, on repeat"); return "She knows one song. She plays it all night."; } },
            { label: "Send her on", detail: () => "No effect.", apply: () => "She sets up one street over instead." },
        ],
    },
    wallet: {
        priority: 22, jitter: 12, title: () => "A lost wallet",
        find: (s) => (s.stats.served >= 10 ? {} : null),
        text: () => "Under one of the eating tables there's a wallet with $45 in it and a library card.",
        choices: [
            { label: "Hand it in", detail: () => "Reputation +3.", apply: (s) => { rep(s, 3); return "The owner comes back in tears and tells everyone she knows."; } },
            { label: "Keep the cash", detail: () => "+$45. A one in three chance somebody saw.", apply: (s) => { s.cash += 45; if (chance(s, 0.35)) { rep(s, -6); return "Somebody saw. It's on the neighbourhood group chat by morning."; } return "Nobody saw."; } },
        ],
    },
};
const ORDER = Object.keys(EVENTS);
/**
 * 3: story beats that must not be missed (a regular's arc, someone about to quit).
 * 2: everyday staff matters. 1: things that just happen on a street.
 */
const TIER = {
    student: 3, studentPayoff: 3, critic: 3, landlordAngry: 3, landlordPleased: 3, poach: 3, nurse: 3, kid: 3, quitThreat: 3, festival: 3, inspector: 3,
    tour: 2, rivalFight: 2, exhausted: 2, raise: 2, friendship: 2, mentor: 2,
    supplier: 1, rain: 1, musician: 1, wallet: 1,
};

/** Choose tonight's event. Called once by the simulation when the night closes. */
export function pickEvent(s) {
    const found = [];
    for (const id of ORDER) {
        const e = EVENTS[id], last = s.eventNight[id];
        if (last != null && (!e.repeat || s.night - last < e.repeat)) continue;
        const ctx = e.find(s);
        if (ctx) found.push({ id, ctx, tier: TIER[id], p: e.priority + rnd(s) * (e.jitter ?? 6) });
    }
    if (!found.length) return null;
    // story beats always win; otherwise staff matters and street happenings take turns, so neither crowds the other out
    let tier = Math.max(...found.map((f) => f.tier));
    if (tier === 2 && found.some((f) => f.tier === 1) && chance(s, 0.45)) tier = 1;
    const best = found.filter((f) => f.tier === tier).sort((a, b) => b.p - a.p)[0];
    s.eventNight[best.id] = s.night;
    return { id: best.id, ctx: best.ctx, done: false, choice: -1, result: "" };
}

const val = (x, s, c) => (typeof x === "function" ? x(s, c) : x);

/** Everything the closing screen needs to show the current event. */
export function describeEvent(s) {
    const ev = s.event;
    if (!ev) return null;
    const e = EVENTS[ev.id], c = ev.ctx;
    const who = val(e.who, s, c);
    return {
        id: ev.id, title: e.title(s, c), text: e.text(s, c), done: ev.done, result: ev.result,
        who: typeof who === "number" ? { vendor: vendorById(s, who) } : who ? { regular: REGULARS[who] } : null,
        choices: e.choices.map((ch, index) => ({ index, ch })).filter((x) => !x.ch.show || x.ch.show(s, c)).map(({ index, ch }) => ({
            index, label: val(ch.label, s, c), detail: (ch.cost ? `$${ch.cost}. ` : "") + ch.detail(s, c), disabled: !!ch.cost && s.cash < ch.cost,
        })),
    };
}

/** Apply the player's choice. `index` is the `index` field from describeEvent().choices. */
export function resolveEvent(s, index) {
    const ev = s.event;
    if (!ev || ev.done) return { ok: false, error: "No open event" };
    const e = EVENTS[ev.id], ch = e.choices[index];
    if (!ch || (ch.show && !ch.show(s, ev.ctx))) return { ok: false, error: "Not an option" };
    if (ch.cost && s.cash < ch.cost) return { ok: false, error: `You need $${ch.cost}` };
    if (ch.cost) s.cash -= ch.cost;
    ev.result = ch.apply(s, ev.ctx);
    ev.done = true; ev.choice = index;
    return { ok: true, text: ev.result };
}

export const EVENT_COUNT = ORDER.length;
