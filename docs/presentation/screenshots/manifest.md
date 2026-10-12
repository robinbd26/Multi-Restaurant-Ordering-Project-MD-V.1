# Presentation screenshots

Captured from a production build (`npm run build` + `npm start`) on the `npm run seed:real` data
with `scripts/presentation/capture.mjs`. Bangla interface unless the line says English.
Desktop shots are 1440x900; mobile shots are 390x844 (saved at 2x pixel density).

## Super admin (`super_admin`)

- [super_admin/01-dashboard.png](./super_admin/01-dashboard.png): Super admin dashboard: users, branches, today's orders and total sales across all 16 branches
- [super_admin/02-brands.png](./super_admin/02-brands.png): Brands: Cheez! Pizza and Madchef, with how many branches and products each has
- [super_admin/03-branches.png](./super_admin/03-branches.png): Branch list: the 16 real branches with their brands, phone, manager and 5 km radius
- [super_admin/04-add-branch.png](./super_admin/04-add-branch.png): Add new branch form: name, phone, brands served, zone, dining or cloud kitchen, address
- [super_admin/05-branch-hours.png](./super_admin/05-branch-hours.png): Uttara hours editor: ordering hours per brand with Delivery and Pickup per time slot
- [super_admin/06-branch-hours-dine-in.png](./super_admin/06-branch-hours-dine-in.png): Uttara dine-in hours 11:00 AM–11:00 PM with the new last guest entry time (10:30 PM)
- [super_admin/07-delivery-areas-map.png](./super_admin/07-delivery-areas-map.png): Delivery areas overview: all 16 branches and their 5 km delivery areas on one map
- [super_admin/08-delivery-area-editor.png](./super_admin/08-delivery-area-editor.png): Delivery area editor (Uttara): the 5 km circle around the branch pin, with its radius slider
- [super_admin/09-users.png](./super_admin/09-users.png): Users: demo staff, riders and customers with role and status
- [super_admin/10-platform-fee.png](./super_admin/10-platform-fee.png): Platform fee settings: one fee for every order, with per-branch overrides
- [super_admin/11-coupons.png](./super_admin/11-coupons.png): Coupons: MADCHEF30, 30% off at every branch, no end date and no usage limits
- [super_admin/12-activity-log.png](./super_admin/12-activity-log.png): Activity log: manager assignments, review flags and other actions, with who did them
- [super_admin/13-reports.png](./super_admin/13-reports.png): Reports: orders, sales and branch performance for the last two weeks

## Management (`management`)

- [management/01-dashboard.png](./management/01-dashboard.png): Management dashboard: today's orders, sales and branch status
- [management/02-branches.png](./management/02-branches.png): Branches: live status of all 16 branches
- [management/03-orders.png](./management/03-orders.png): All orders across branches, filterable by status and branch
- [management/04-performance.png](./management/04-performance.png): Branch performance comparison
- [management/05-sales-report.png](./management/05-sales-report.png): Sales report for the last two weeks
- [management/06-complaints.png](./management/06-complaints.png): Complaints from all branches with their status

## Marketing (`marketing`)

- [marketing/01-dashboard.png](./marketing/01-dashboard.png): Marketing dashboard: campaigns, coupon use and customer reach
- [marketing/02-coupons.png](./marketing/02-coupons.png): Coupons: MADCHEF30 (30% off everything, every branch) with its use count
- [marketing/03-campaigns.png](./marketing/03-campaigns.png): Campaigns: the MADCHEF30 campaign sent to customers, with its reach
- [marketing/04-review-moderation.png](./marketing/04-review-moderation.png): Review moderation: product reviews with ratings, one flagged by a branch manager

## Branch manager, Uttara (`branch_manager`)

- [branch_manager/01-dashboard.png](./branch_manager/01-dashboard.png): Uttara branch dashboard: today's orders, open orders and riders on duty
- [branch_manager/02-orders.png](./branch_manager/02-orders.png): Uttara orders: pending, preparing, delivered, collected and cancelled
- [branch_manager/03-order-detail.png](./branch_manager/03-order-detail.png): Order detail: items, customer, rider and the status timeline from Pending to Delivered
- [branch_manager/04-order-chat.png](./branch_manager/04-order-chat.png): Order chat on the same order: customer, branch and rider in one thread
- [branch_manager/05-delivery-area.png](./branch_manager/05-delivery-area.png): Uttara delivery area: a 5 km circle around the branch, ৳60, 45 minutes
- [branch_manager/06-branch-hours.png](./branch_manager/06-branch-hours.png): Uttara ordering hours for Cheez and Madchef
- [branch_manager/07-branch-hours-dine-in.png](./branch_manager/07-branch-hours-dine-in.png): Dine-in hours with last guest entry 10:30 PM
- [branch_manager/08-branch-settings.png](./branch_manager/08-branch-settings.png): Branch settings: delivery radius, fee, prep time and pickup point
- [branch_manager/09-complaints.png](./branch_manager/09-complaints.png): Complaints routed to Uttara, with status
- [branch_manager/10-reviews.png](./branch_manager/10-reviews.png): Reviews of Uttara's dishes with ratings
- [branch_manager/11-riders.png](./branch_manager/11-riders.png): Riders on duty at Uttara, on the live map

## Accounts (`accounts`)

- [accounts/01-dashboard.png](./accounts/01-dashboard.png): Accounts dashboard: sales, platform fees, rider commissions
- [accounts/02-reports.png](./accounts/02-reports.png): Financial reports for the last two weeks
- [accounts/03-invoices.png](./accounts/03-invoices.png): Invoices list
- [accounts/04-invoice.png](./accounts/04-invoice.png): One invoice: items, MADCHEF30 discount, delivery charge, platform fee and total
- [accounts/05-rider-earnings.png](./accounts/05-rider-earnings.png): Rider earnings: commission per delivered order

## Rider, Uttara (`rider`), mobile

- [rider/01-job-offer.png](./rider/01-job-offer.png): Job offer: accept or reject a new delivery (Uttara)
- [rider/02-dashboard-active.png](./rider/02-dashboard-active.png): Rider home: on duty at Uttara, with the current delivery
- [rider/03-active-delivery.png](./rider/03-active-delivery.png): Active delivery: customer, address, items and the Picked up / On the way / Delivered buttons
- [rider/04-delivery-map.png](./rider/04-delivery-map.png): Delivery map: the branch and the customer's pin
- [rider/05-order-chat.png](./rider/05-order-chat.png): Order chat from the rider's phone: rider, customer and branch in one thread
- [rider/06-earnings.png](./rider/06-earnings.png): Earnings: commission for each delivered order, including this one
- [rider/07-delivery-history.png](./rider/07-delivery-history.png): Delivery history with each order's steps

## Customer (`customer`)

- [customer/01-home-desktop.png](./customer/01-home-desktop.png): Customer homepage (desktop): both brands, nearest branch Uttara, delivery fee and time
- [customer/02-cheez-menu.png](./customer/02-cheez-menu.png): Cheez menu at Uttara: crust and size guide, then the pizzas with photos and prices
- [customer/03-cheez-combos.png](./customer/03-cheez-combos.png): Cheez combos: Classic Combo ৳449 and Premium Combo ৳549, 8 inch, thick or thin
- [customer/04-madchef-menu.png](./customer/04-madchef-menu.png): Madchef menu at Uttara: burgers, wraps, rice meals and more
- [customer/05-product-popup.png](./customer/05-product-popup.png): Product popup (Bolognese): photo, description, sizes and price
- [customer/06-product-popup-reviews.png](./customer/06-product-popup-reviews.png): The same popup scrolled to its customer reviews and star rating
- [customer/07-cart.png](./customer/07-cart.png): Cart: a Cheez pizza and a Madchef burger from Uttara, with delivery and pickup buttons
- [customer/08-checkout-delivery-address.png](./customer/08-checkout-delivery-address.png): Checkout for delivery: choose the saved Uttara address (inside the delivery area)
- [customer/09-add-address-map.png](./customer/09-add-address-map.png): Add a new address by picking the spot on the map (with address search)
- [customer/10-checkout-payment-coupon.png](./customer/10-checkout-payment-coupon.png): Payment step: cash on delivery or bKash, with coupon MADCHEF30 entered
- [customer/11-checkout-overview-madchef30.png](./customer/11-checkout-overview-madchef30.png): Order overview before confirming: MADCHEF30 takes 30% off, plus delivery charge and platform fee
- [customer/12-checkout-pickup.png](./customer/12-checkout-pickup.png): Checkout for pickup: collect from Uttara, with the address, hours and a pickup time
- [customer/13-home-mobile.png](./customer/13-home-mobile.png): Customer homepage on a phone (mobile)
- [customer/14-cheez-menu-mobile.png](./customer/14-cheez-menu-mobile.png): Cheez menu on a phone (mobile)
- [customer/15-home-desktop-english.png](./customer/15-home-desktop-english.png): Customer homepage in English
- [customer/16-product-popup-english.png](./customer/16-product-popup-english.png): Product popup in English (Bolognese)
- [customer/17-complaint-form.png](./customer/17-complaint-form.png): Complaint form: pick the order and category; it goes to that order's branch
- [customer/18-reviews.png](./customer/18-reviews.png): My reviews: dishes from delivered orders, with star ratings
- [customer/19-order-placed-madchef30.png](./customer/19-order-placed-madchef30.png): Order placed with MADCHEF30 applied: the 30% discount on the receipt
- [customer/20-order-tracking.png](./customer/20-order-tracking.png): Order tracking: status timeline, rider, and delivery estimate
- [customer/21-order-chat.png](./customer/21-order-chat.png): Order chat from the customer's side, with the rider's message

## Blocked customer (`blocked_customer`)

- [blocked_customer/01-order-refused.png](./blocked_customer/01-order-refused.png): A blocked account can browse but not order: confirming shows 'your account is blocked, contact the helpline'

## Order journey at Uttara, step by step

- [journey/01-customer-confirms-order.png](./journey/01-customer-confirms-order.png): 1. Customer (Uttara) reviews the order: Classic Combo + Mad Chicken Sandwich, coupon MADCHEF30, cash on delivery
- [journey/02-customer-order-placed.png](./journey/02-customer-order-placed.png): 2. Order placed: the receipt shows the MADCHEF30 discount (30% off), delivery charge and platform fee
- [journey/03-customer-tracking-pending.png](./journey/03-customer-tracking-pending.png): 3. Customer's order page: waiting for the branch to accept
- [journey/04-branch-new-order.png](./journey/04-branch-new-order.png): 4. Uttara branch manager: the new order arrives at the top of the list as Pending
- [journey/05-branch-order-pending.png](./journey/05-branch-order-pending.png): 5. Order detail at the branch: items, customer note, and the Accept button
- [journey/06-branch-accepted.png](./journey/06-branch-accepted.png): 6. Branch accepted the order
- [journey/07-branch-preparing-rider-assigned.png](./journey/07-branch-preparing-rider-assigned.png): 7. Preparing, and the Uttara rider is assigned (the rider gets a job offer)
- [journey/08-branch-ready-for-rider.png](./journey/08-branch-ready-for-rider.png): 8. Marked Ready for rider
- [journey/09-rider-job-offer.png](./journey/09-rider-job-offer.png): 9. Rider's phone: the job offer pops up with the pickup, drop-off and distance
- [journey/10-rider-accepted.png](./journey/10-rider-accepted.png): 10. Rider accepted: the active delivery with the Picked up button
- [journey/11-rider-picked-up.png](./journey/11-rider-picked-up.png): 11. Rider picked the order up at the branch
- [journey/12-rider-on-the-way.png](./journey/12-rider-on-the-way.png): 12. On the way to the customer
- [journey/13-customer-tracking-on-the-way.png](./journey/13-customer-tracking-on-the-way.png): 13. Customer's tracking: On the way, with the rider's name and the timeline
- [journey/14-customer-chat.png](./journey/14-customer-chat.png): 14. Customer and rider chat on the order
- [journey/15-rider-delivered.png](./journey/15-rider-delivered.png): 15. Rider marks it Delivered
- [journey/16-customer-tracking-delivered.png](./journey/16-customer-tracking-delivered.png): 16. Customer's tracking at the end: Delivered, every step with its time
- [journey/17-branch-order-delivered.png](./journey/17-branch-order-delivered.png): 17. The branch sees the finished order, with the full status history
