# Source Requirements - User Roles & Permissions

> Verbatim extraction of User_Roles_Permissions_Corrected.docx (source of truth for the gap analysis).

**Food Delivery System — User Roles & Permissions**
Corrected and reorganized version
This document lists the seven user roles — Super Admin, Branch Manager, Rider, Customer, Accounts, Marketing, and Management — with spelling, spacing, and grammar corrected, and duplicate points merged.

## 1. Super Admin

- Permission/approval of other accounts.
- Can set rider delivery fees.
- Can view all information: customer accounts, blocked customer accounts, total sales report, top-selling products, push notifications for any category or account type, and branch manager information.
- Can block customers (fake-order customers).
- Can send notices.
- Can view all complaints (customer, branch manager, rider, accounts, marketing).
- Can create coins and set their value (Tk).
- Can access all staff data (name, contact number, photo, joining date, company post).
- Can hold operations of any branch.
- Can hold a product — if the Super Admin holds a product, it is held across all branches.
- Can view today's sales report.
- Can view today's order report.
- Can view today's cancelled-order report.
- Can view daily attendance (all sections).
- Can create product categories.
- Can view all products across all branches, including deactivated products with their reasons.

## 2. Branch Manager

- Can view incoming customer orders with a sound alert before accepting — includes order details, payment method, and delivery address.
- Can change order status: Received, Cooking, Ready for Delivery, Rider Received the Food, On the Way, Complete, Cancel.
- Can view rider information (online/offline/on duty) and the rider's live pin location on Google Maps.
- Can assign a rider for delivery; the customer can then see which rider is delivering their order.
- Can view other reports (e.g., the branch manager's dashboard page).
- Can mark daily attendance.
- Can add products under categories created by the Super Admin.
- Can activate/deactivate products, with a reason.
- Can set the delivery zone.
- Can set delivery hours / time slots.
- Can send and receive complaints (visible to the developer/Super Admin).
- Login history is recorded, showing when duties were performed.
- Each branch maintains its own history of which managers were on duty and when.
- Can view the sales report.
- Receives table-reservation requests for the branch, including the requested time and the customer's name and phone number. A messaging session is created so the customer and branch manager can chat; they can also contact each other by phone (number provided), and the system supports initiating calls directly.
- A separate section (left sidebar) is available for Ramadan table bookings, where the branch manager can configure table layout and capacity, and customers can book tables.

## 3. Rider

- Rider can log in using authorized credentials.
- Can view all assigned orders with full details.
- Can accept assigned delivery requests.
- Can update order status (Received, Picked Up, On the Way, Delivered, Delayed, Cancelled).
- Can inform the customer about delivery-related issues.
- Can notify the customer if extra delivery time is needed.
- Can send delivery-related messages to the customer.
- Can navigate to the customer's location via GPS/Google Maps.
- Can switch between online and offline status.
- The system automatically updates live location while the rider is online.
- The customer can track the rider's location in real time.
- The branch manager can also view the rider's real-time location.
- Super Admin can set the rider's commission for each completed delivery.
- Commission is added to the rider's dashboard after each completed delivery.
- Rider can request a commission withdrawal against the available balance.
- Once a withdrawal is approved and completed, the amount is automatically deducted from the balance.
- Rider can view the status of submitted withdrawal requests.
- Can mark daily attendance and view attendance history.
- Can view login history.
- The system maintains a full duty log (login records, attendance, completed deliveries, travel distance, working hours).
- The rider's full route history during duty — visited locations and travel route — is saved.
- Can view daily, weekly, and monthly delivery performance.
- Can view total travel distance for deliveries.
- Can view total completed deliveries, total earnings, available balance, and withdrawal history.
- A dedicated complaint section (like an inbox) is available for riders.
- Rider can submit a complaint or issue through this section and select the recipient.
- Complaints can be sent to the Branch Manager, Super Admin, Accounts, or Management.
- Rider can view the status of submitted complaints (Pending, In Progress, Resolved, Closed).
- Rider receives push notifications for new delivery requests and important announcements.

## 4. Customer

- Customer can log in using phone number, email, or another authorized method; OTP/secure login is supported.
- Can browse food items from all available restaurants and branches.
- Can place an order from the nearest branch based on the delivery location, which can be selected via Google Maps.
- If the location is outside the delivery coverage area, an "Out of Delivery Zone" message is shown along with the nearest pickup point.
- Can track order status in real time.
- Can view the rider's live location on the map once a rider is assigned.
- Can add and update profile information (name, contact, multiple addresses such as Home, Office, Second Home) and edit or delete saved addresses.
- Completing the profile earns reward coins; daily login or other reward activities can also earn coins.
- Super Admin configures the value and rules of reward coins; the customer can view their available coin balance and redeem coins per the configured rules/conditions.
- After a successful delivery, the customer can rate and give feedback on the rider, and can also review the delivered food.
- Can submit complaints about food quality, delivery issues, or service problems to the Branch Manager, Super Admin, Accounts, or Management.
- Can view complete order history and reorder any previous order with one click.
- Receives real-time notifications for every order status update — rider assigned, rider on the way, rider-reported delays/issues, and status updates from the branch manager or rider — and can toggle notifications on/off from settings.
- Can view total completed orders, total cancelled orders, and overall account activity/order statistics.
- Profile, saved addresses, notifications, rewards, order history, and account settings are all manageable from a single dedicated dashboard.
- The helpline number is clearly visible.
- The entire interface is mobile-responsive and user-friendly.

## 5. Accounts

- Accounts personnel can log in using authorized credentials and access the Accounts dashboard.
- Can view all customer payments, and all completed, pending, cancelled, and refunded transactions.
- Can manage rider commission records, configured according to rules set by the Super Admin.
- Can view rider earnings and available balance.
- Can review, approve, or reject rider withdrawal requests; once approved, the paid amount is automatically deducted from the rider's balance. A complete withdrawal history is maintained.
- Can generate daily, weekly, monthly, and yearly financial reports.
- Can view branch-wise sales reports and revenue summaries.
- Can view delivery-charge collections and payment-method reports (cash, card, mobile banking, etc.).
- Can process customer refunds per Super Admin policy and keep refund records.
- Can view invoice details for every order, and generate/download invoices.
- Can search/filter transactions by order ID, customer, rider, branch, payment method, or date range.
- Can view rider and customer payment histories, and monitor outstanding/pending payments.
- Can record authorized manual financial adjustments.
- Receives notifications for new withdrawal requests or important financial events.
- Maintains an audit log of all financial activity.
- Can view reports on tax, service charge, discounts, coupons, and promotional deductions.
- Maintains branch settlement records and generates end-of-day reports.
- Can view total income, expenses, and net revenue, plus payment reconciliation reports.
- Can access the financial module only per the role-based permissions defined by the Super Admin.
- Can generate monthly (or as-needed) financial summaries.
- Can view, monitor, and generate branch-wise expense reports (rent, utilities, salary, maintenance, inventory purchases, delivery-related costs, etc.).

## 6. Marketing

- Marketing logs in with separate credentials.
- Campaign management — create, edit, and schedule discount coupons, offers, and promotions.
- Target audience segmentation — group users by location, order history, or user behavior.
- Send marketing notifications for offers, new menu items, or event updates.
- View campaign performance reports — opens, clicks, conversions, etc.
- Monitor customer/rider feedback and suggestions to improve marketing strategy.

## 7. Management

- Can log in using authorized credentials and access the Management dashboard.
- Can view overall business performance.
- Can view total sales reports (daily, weekly, monthly, yearly) and branch-wise sales reports.
- Can monitor branch performance and view total completed, pending, and cancelled orders.
- Can monitor performance across all branches, including branch managers and riders.
- Can monitor customer growth and new customer registrations.
- Can view the most and least selling products/categories.
- Can view branch-wise revenue and profit reports, and branch-wise expense reports.
- Can monitor the financial summary and profit/loss.
- Can view rider commission and withdrawal reports.
- Can view customer feedback/ratings and all complaints (customer, rider, branch manager) with resolution status.
- Can monitor marketing campaign performance and view coupon/promotional offer reports.
- Can monitor delivery performance, average delivery time, and delivery-zone performance reports.
- Can monitor branch attendance reports.
- Can generate daily, weekly, monthly, and yearly business reports, exportable as PDF or Excel.
- Receives important business notifications and alerts.
- Can monitor inventory and product availability across all branches.
- Can view system-wide operational statistics on a graphical dashboard, and compare performance across multiple branches.
- Can view customer retention and repeat-order statistics, along with business growth trends and analytics.
- Can access all reports as permitted by the Super Admin.
