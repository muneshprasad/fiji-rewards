# How the money works

Decisions made for the pilot: the **network** settles everything, **1 point = FJD 0.01**, settlement is **real and monthly**, and the network **earns** from a small margin.

## The rules
- A customer earns points when they spend (default 1 point per FJD 1, each shop can set 0.5 to 5).
- A shop that **issues** points pays the network **FJD 0.012 per point**. (Its cost is therefore *rate × 1.2%* of its sales: at 1 point per FJD that is 1.2% of sales, at 2 points per FJD it is 2.4%.)
- A shop whose reward is **redeemed** is repaid **FJD 0.01 for each point spent**, whichever shop issued the points.
- Optional: a flat monthly fee per active shop (set to 0 for now).
- The network keeps: the margin (FJD 0.002 per point issued), any monthly fees, and the value of points that **expire unspent** after 12 months.

All three numbers are settings in `network_settings`: `point_value_fjd`, `issue_fee_fjd_per_point`, `monthly_shop_fee_fjd`. Change them with, for example:
```sql
update network_settings set value = 0.013 where key = 'issue_fee_fjd_per_point';
```
Change them only at the start of a month. Statements store the rates they used, and issued statements never change.

## Price rewards at the point value
Each reward has a points cost and a FJD value. The network repays shops by points, so a reward is fairly priced when `points = value / 0.01`:

| Reward worth | Points |
|---|---|
| FJD 3 | 300 |
| FJD 5 | 500 |
| FJD 10 | 1,000 |

Fewer points than that means the shop gives more than it is repaid. The rewards screen shows the matching number.

## A worked example (one month)
- Customer spends FJD 100 at Shop A and earns 100 points. Shop A is charged 100 × 0.012 = **FJD 1.20**.
- The customer spends 300 points on a FJD 3 reward at Shop B. Shop B is repaid 300 × 0.01 = **FJD 3.00**.
- At month end: Shop A pays FJD 1.20 (less whatever its own rewards were repaid). Shop B receives FJD 3.00 (less what it was charged for points it issued). Only the difference between each shop's two amounts moves.

## What the network can expect to earn
Be realistic about year one:
- The margin is **0.2% of the sales that earned points** (at 1 point per FJD). On FJD 60,000 of monthly sales across three shops that is about **FJD 120 a month**.
- Money from points issued is **mostly held, not earned**: shops pay 1.2% in, but customers claim it back at 1% as they redeem. Keep the unredeemed amount ("owed to future redemptions" on the Money screen) set aside. It is a liability, not profit.
- **Expired points** (the third source of income) only appear **12 months after** points are earned, so there is none in the first year.
- To earn more in year one, use the monthly shop fee. For example FJD 30 for each of 20 shops is FJD 600 a month.

## The monthly routine
1. On the 1st, open **Admin > Money** in the app (admin accounts only) and pick last month.
2. Tap **Calculate statements**. Check the numbers.
3. Tap **Issue statement** for each shop. Shops can now see it under **Monthly statements** (shop managers only). Issued statements cannot change.
4. Shops that owe pay the network. Pay the shops the network owes. Use a bank transfer or mobile money; the app does not move money.
5. After the money has moved, tap **Mark as paid**.

## Check before real money moves
- Whether holding the shops' payments, and the points liability, needs regulatory treatment (Reserve Bank of Fiji) or counts as stored value.
- VAT on the network's fees, and how unredeemed points are accounted for.
- The terms shops sign (who is liable for what), and what customers are told about expiry.
I can't answer these. A local lawyer and accountant can.
