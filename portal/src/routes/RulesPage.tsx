import { formatIndianCurrency, rewardSlabs } from "../features/referrals/referralUtils";

const conditions = [
  "Reward becomes eligible after at least 50% of the final agreed course fee is received",
  "Referral remains valid for 90 days",
  "First valid accepted referral for the same prospect applies",
  "Old enquiries, current students, former students and invalid referrals are not eligible",
  "Reward approval is required",
  "Approved payout should be processed within 7 days",
  "Course credit is valid for 12 months",
  "Course credit may be transferred to immediate family",
  "Cancellation may lead to reward adjustment or recovery",
];

export function RulesPage() {
  return (
    <div className="content-stack rewards-page">
      <header className="page-header">
        <h1>Rewards & Benefits</h1>
        <p>The reward is based on the final discounted course fee paid by the referred student.</p>
      </header>

      <section className="reward-slabs" aria-labelledby="reward-slabs-title">
        <h2 id="reward-slabs-title">Reward slabs</h2>
        <div className="reward-table" role="table" aria-label="Reward slabs based on final discounted course fee">
          <div className="reward-table__row reward-table__row--head" role="row">
            <span role="columnheader">Final discounted course fee</span>
            <span role="columnheader">Cash reward</span>
            <span role="columnheader">Course credit</span>
          </div>
          {rewardSlabs.map((slab) => (
            <div className="reward-table__row" role="row" key={slab.fee}>
              <span role="cell">{slab.fee}</span>
              <strong role="cell">{formatIndianCurrency(slab.cash)} cash</strong>
              <strong role="cell">{formatIndianCurrency(slab.credit)} course credit</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="friend-benefit" aria-labelledby="friend-benefit-title">
        <h2 id="friend-benefit-title">A benefit for your friend too</h2>
        <p>After successful admission, your referred friend receives a complimentary classroom AI Prompting Crash Course.</p>
      </section>

      <section className="reward-comparison" aria-label="Reward options">
        <article>
          <h2>Cash reward</h2>
          <ul>
            <li>Paid after eligibility and approval</li>
            <li>Useful as an immediate reward</li>
          </ul>
        </article>
        <article>
          <h2>Course credit</h2>
          <ul>
            <li>Higher value than cash</li>
            <li>Can be used for a Samyak course</li>
            <li>Valid for 12 months</li>
            <li>May be transferred to an immediate family member</li>
          </ul>
        </article>
      </section>

      <section className="important-conditions" aria-labelledby="important-conditions-title">
        <h2 id="important-conditions-title">Important conditions</h2>
        <div className="condition-list">
          {conditions.map((condition) => (
            <details key={condition}>
              <summary>{condition}</summary>
              <p>Our team checks this before approving a referral reward.</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
