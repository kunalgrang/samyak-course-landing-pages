export function RulesPage() {
  return (
    <div className="content-stack">
      <header className="page-header">
        <h1>Rules</h1>
        <p>Programme rules for Samyak Skill Circle rewards.</p>
      </header>
      <section className="rules-list">
        <Rule title="Reward slabs" text="Rewards are calculated from the course reward slab active for the referred programme." />
        <Rule title="Eligibility condition" text="A reward becomes eligible only after at least 50% of the final agreed course fee is received." />
        <Rule title="Referral validity" text="Each accepted referral remains valid for 90 days from submission." />
        <Rule title="First valid submission" text="When more than one referral exists for the same prospect, the first valid accepted submission applies." />
        <Rule title="Exclusions" text="Old enquiries, current students, former students, invalid mobile numbers, and invalid referral links are not reward eligible." />
        <Rule title="Cash or course credit" text="Eligible referrers may choose cash reward or Samyak course credit where both options are available." />
        <Rule title="Course-credit validity" text="Approved course credit is valid for 12 months." />
        <Rule title="Immediate-family transfer" text="Course credit may be transferred to an immediate family member." />
        <Rule title="Cancellation adjustment" text="If an admission is cancelled after reward processing, the reward may be adjusted or recovered." />
      </section>
    </div>
  );
}

function Rule({ title, text }: { title: string; text: string }) {
  return (
    <article className="rule">
      <h2>{title}</h2>
      <p>{text}</p>
    </article>
  );
}
