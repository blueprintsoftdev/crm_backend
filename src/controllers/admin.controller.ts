import { Request, Response } from "express";
import bcrypt from "bcrypt";
import { prisma } from "../config/database";
import logger from "../utils/logger";
import { createAuditLog } from "../utils/auditLog";

const calculatePercentage = (current: number, previous: number): number => {
  if (previous === 0) return current === 0 ? 0 : 100;
  return ((current - previous) / previous) * 100;
};

const daysAgo = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
};

// GET /api/admin/summary  (admin)
export const getAdminSummary = async (_req: Request, res: Response) => {
  try {
    const last30 = daysAgo(30);
    const prev30 = daysAgo(60);

    // ── Stats Cards ─────────────────────────────────────────────────────────
    const [
      orderTotal,
      orderCurrent,
      orderPrev,
      userTotal,
      userCurrent,
      userPrev,
      productTotal,
      productCurrent,
      productPrev,
    ] = await Promise.all([
      prisma.order.count(),
      prisma.order.count({ where: { createdAt: { gte: last30 } } }),
      prisma.order.count({ where: { createdAt: { gte: prev30, lt: last30 } } }),

      prisma.user.count({ where: { role: "CUSTOMER" } }),
      prisma.user.count({
        where: { role: "CUSTOMER", createdAt: { gte: last30 } },
      }),
      prisma.user.count({
        where: { role: "CUSTOMER", createdAt: { gte: prev30, lt: last30 } },
      }),

      prisma.product.count(),
      prisma.product.count({ where: { createdAt: { gte: last30 } } }),
      prisma.product.count({
        where: { createdAt: { gte: prev30, lt: last30 } },
      }),
    ]);

    // Revenue (sum of finalAmount on PAID orders)
    const revenueAll = await prisma.order.aggregate({
      where: { paymentStatus: "PAID" },
      _sum: { finalAmount: true },
    });
    const revenueCurrent = await prisma.order.aggregate({
      where: { paymentStatus: "PAID", createdAt: { gte: last30 } },
      _sum: { finalAmount: true },
    });
    const revenuePrev = await prisma.order.aggregate({
      where: { paymentStatus: "PAID", createdAt: { gte: prev30, lt: last30 } },
      _sum: { finalAmount: true },
    });

    // ── Sales Chart (last 7 days) ────────────────────────────────────────────
    const sevenDaysAgo = daysAgo(7);
    const paidOrdersLast7 = await prisma.order.findMany({
      where: { paymentStatus: "PAID", createdAt: { gte: sevenDaysAgo } },
      select: { finalAmount: true, createdAt: true },
    });

    // Group by date
    const salesByDate: Record<string, { revenue: number; orders: number }> = {};
    for (const o of paidOrdersLast7) {
      const day = o.createdAt.toISOString().split("T")[0];
      if (!salesByDate[day]) salesByDate[day] = { revenue: 0, orders: 0 };
      salesByDate[day].revenue += o.finalAmount;
      salesByDate[day].orders += 1;
    }
    const salesChart = Object.entries(salesByDate)
      .map(([_id, v]) => ({ _id, ...v }))
      .sort((a, b) => a._id.localeCompare(b._id));

    // ── Latest Orders ────────────────────────────────────────────────────────
    const latestOrders = await prisma.order.findMany({
      include: {
        user: { select: { id: true, username: true, email: true } },
        items: {
          include: {
            product: {
              select: { id: true, name: true, price: true, image: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    res.status(200).json({
      summary: {
        revenue: {
          total: revenueAll._sum.finalAmount ?? 0,
          growth: calculatePercentage(
            revenueCurrent._sum.finalAmount ?? 0,
            revenuePrev._sum.finalAmount ?? 0,
          ),
        },
        orders: {
          total: orderTotal,
          growth: calculatePercentage(orderCurrent, orderPrev),
        },
        users: {
          total: userTotal,
          growth: calculatePercentage(userCurrent, userPrev),
        },
        products: {
          total: productTotal,
          growth: calculatePercentage(productCurrent, productPrev),
        },
      },
      salesChart,
      latestOrders,
    });
  } catch (err: any) {
    logger.error("getAdminSummary error", err);
    res.status(500).json({ message: "Error loading dashboard data" });
  }
};

// GET /api/admin/dashboard  (admin) — full live snapshot for dashboard home
export const getDashboardData = async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const sevenDaysAgo = daysAgo(7);
    const thirtyDaysAgo = daysAgo(30);
    const sixtyDaysAgo = daysAgo(60);

    const [
      // Summary stats
      totalRevenueAgg,
      thisMonthRevenueAgg,
      prevMonthRevenueAgg,
      totalOrders,
      thisMonthOrders,
      prevMonthOrders,
      pendingOrders,
      totalCustomers,
      thisMonthCustomers,
      prevMonthCustomers,
      totalProducts,
      // Sales chart last 7 days
      last7PaidOrders,
      // Order status counts
      processingCount,
      confirmedCount,
      shippedCount,
      deliveredCount,
      cancelledCount,
      // Low stock products
      lowStockProducts,
      // Recent orders
      recentOrders,
      // Payment methods
      onlineAgg,
      codAgg,
      // Order items for top categories
      categoryOrderItems,
      // Top products
      topProductItems,
    ] = await Promise.all([
      prisma.order.aggregate({ where: { paymentStatus: "PAID" }, _sum: { finalAmount: true } }),
      prisma.order.aggregate({ where: { paymentStatus: "PAID", createdAt: { gte: thirtyDaysAgo } }, _sum: { finalAmount: true } }),
      prisma.order.aggregate({ where: { paymentStatus: "PAID", createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } }, _sum: { finalAmount: true } }),
      prisma.order.count(),
      prisma.order.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      prisma.order.count({ where: { createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } } }),
      prisma.order.count({ where: { orderStatus: "PROCESSING" } }),
      prisma.user.count({ where: { role: "CUSTOMER" } }),
      prisma.user.count({ where: { role: "CUSTOMER", createdAt: { gte: thirtyDaysAgo } } }),
      prisma.user.count({ where: { role: "CUSTOMER", createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } } }),
      prisma.product.count(),
      // Last 7 days paid orders for revenue chart
      prisma.order.findMany({
        where: { paymentStatus: "PAID", createdAt: { gte: sevenDaysAgo } },
        select: { finalAmount: true, createdAt: true },
      }),
      // Order status breakdown
      prisma.order.count({ where: { orderStatus: "PROCESSING" } }),
      prisma.order.count({ where: { orderStatus: "CONFIRMED" } }),
      prisma.order.count({ where: { orderStatus: "SHIPPED" } }),
      prisma.order.count({ where: { orderStatus: "DELIVERED" } }),
      prisma.order.count({ where: { orderStatus: "CANCELLED" } }),
      // Low stock: products with stock <= 10, ordered by stock asc
      prisma.product.findMany({
        where: { stock: { lte: 10 } },
        select: { id: true, name: true, stock: true, image: true, category: { select: { name: true } } },
        orderBy: { stock: "asc" },
        take: 8,
      }),
      // Recent orders
      prisma.order.findMany({
        select: {
          id: true,
          finalAmount: true,
          orderStatus: true,
          paymentStatus: true,
          paymentMethod: true,
          createdAt: true,
          user: { select: { username: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 8,
      }),
      // Payment methods
      prisma.order.aggregate({ where: { paymentMethod: "ONLINE" }, _sum: { finalAmount: true }, _count: { id: true } }),
      prisma.order.aggregate({ where: { paymentMethod: "POD" }, _sum: { finalAmount: true }, _count: { id: true } }),
      // Category revenue
      prisma.orderItem.findMany({
        select: {
          quantity: true,
          price: true,
          product: { select: { category: { select: { id: true, name: true } } } },
        },
        take: 5000,
      }),
      // Top products by revenue
      prisma.orderItem.groupBy({
        by: ["productId"],
        _sum: { price: true, quantity: true },
        orderBy: { _sum: { price: "desc" } },
        take: 5,
      }),
    ]);

    // ── Build sales chart (last 7 days) ────────────────────────────────────
    const salesByDate: Record<string, { date: string; revenue: number; orders: number }> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = d.toISOString().split("T")[0];
      salesByDate[key] = { date: key, revenue: 0, orders: 0 };
    }
    for (const o of last7PaidOrders) {
      const key = o.createdAt.toISOString().split("T")[0];
      if (salesByDate[key]) {
        salesByDate[key].revenue += o.finalAmount;
        salesByDate[key].orders += 1;
      }
    }

    // ── Build category breakdown ───────────────────────────────────────────
    const catMap: Record<string, { name: string; revenue: number; unitsSold: number }> = {};
    for (const item of categoryOrderItems) {
      const cat = item.product?.category;
      if (!cat) continue;
      if (!catMap[cat.id]) catMap[cat.id] = { name: cat.name, revenue: 0, unitsSold: 0 };
      catMap[cat.id].revenue += item.price;
      catMap[cat.id].unitsSold += item.quantity;
    }
    const topCategories = Object.entries(catMap)
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 6);

    // ── Resolve top product names ──────────────────────────────────────────
    const productIds = topProductItems.map((i) => i.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, price: true, image: true },
    });
    const productMap = Object.fromEntries(products.map((p) => [p.id, p]));
    const topProducts = topProductItems.map((item) => ({
      product: productMap[item.productId] ?? null,
      totalRevenue: item._sum.price ?? 0,
      totalQuantitySold: item._sum.quantity ?? 0,
    }));

    const pct = (curr: number, prev: number) => {
      if (prev === 0) return curr === 0 ? 0 : 100;
      return Math.round(((curr - prev) / prev) * 100);
    };

    res.json({
      summary: {
        revenue: {
          total: totalRevenueAgg._sum.finalAmount ?? 0,
          thisMonth: thisMonthRevenueAgg._sum.finalAmount ?? 0,
          growthPct: pct(thisMonthRevenueAgg._sum.finalAmount ?? 0, prevMonthRevenueAgg._sum.finalAmount ?? 0),
        },
        orders: {
          total: totalOrders,
          thisMonth: thisMonthOrders,
          pending: pendingOrders,
          growthPct: pct(thisMonthOrders, prevMonthOrders),
        },
        customers: {
          total: totalCustomers,
          thisMonth: thisMonthCustomers,
          growthPct: pct(thisMonthCustomers, prevMonthCustomers),
        },
        products: { total: totalProducts },
      },
      salesChart: Object.values(salesByDate),
      orderStatus: [
        { status: "PROCESSING", count: processingCount },
        { status: "CONFIRMED", count: confirmedCount },
        { status: "SHIPPED", count: shippedCount },
        { status: "DELIVERED", count: deliveredCount },
        { status: "CANCELLED", count: cancelledCount },
      ].filter((s) => s.count > 0),
      topCategories,
      topProducts,
      lowStockProducts,
      recentOrders,
      paymentMethods: [
        { method: "ONLINE", count: onlineAgg._count.id, revenue: onlineAgg._sum.finalAmount ?? 0 },
        { method: "COD", count: codAgg._count.id, revenue: codAgg._sum.finalAmount ?? 0 },
      ],
    });
  } catch (err: any) {
    logger.error("getDashboardData error", err);
    res.status(500).json({ message: "Error loading dashboard snapshot" });
  }
};

// GET /api/admin/users?page=1&limit=20  (admin)
export const getAllUsers = async (req: Request, res: Response) => {
  try {
    const { page = "1", limit = "20", role } = req.query as Record<string, string | undefined>;

    const pageSize = Math.min(Math.max(parseInt(limit ?? "20") || 20, 1), 100);
    const skip = (Math.max(parseInt(page ?? "1") || 1, 1) - 1) * pageSize;

    // SUPER_ADMIN is always excluded — Admin is unaware of Super Admin's presence.
    // If a role filter is provided, respect it but never expose SUPER_ADMIN.
    const allowedRoles: ("CUSTOMER" | "ADMIN")[] = ["CUSTOMER", "ADMIN"];
    const requestedRole = role?.toUpperCase() as "CUSTOMER" | "ADMIN" | undefined;
    const where =
      requestedRole && allowedRoles.includes(requestedRole)
        ? { role: requestedRole }
        : { role: { in: allowedRoles } };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          username: true,
          email: true,
          phone: true,
          role: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      users,
      pagination: {
        total,
        page: Math.max(parseInt(page ?? "1") || 1, 1),
        limit: pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err: any) {
    logger.error("getAllUsers error", err);
    res.status(500).json({ message: "Error fetching users" });
  }
};

// POST /api/admin/users  (admin)
export const createAdminUser = async (req: Request, res: Response) => {
  try {
    const { username, email, phone, password, role } = req.body as {
      username: string;
      email: string;
      phone: string;
      password: string;
      role: string;
    };

    const emailExisted = await prisma.user.findFirst({ where: { email } });
    if (emailExisted)
      return res.status(400).json({ Error: "An account with this email address already exists." });

    const phoneExisted = await prisma.user.findFirst({ where: { phone } });
    if (phoneExisted)
      return res.status(400).json({ Error: "An account with this phone number already exists." });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Admin cannot create another SUPER_ADMIN through this endpoint
    if (role.toUpperCase() === "SUPER_ADMIN" && req.user?.role !== "SUPER_ADMIN") {
      return res.status(403).json({ message: "Cannot create a Super Admin account via this endpoint." });
    }

    const normalizedRole = role.toUpperCase() as "CUSTOMER" | "ADMIN" | "SUPER_ADMIN";

    await prisma.user.create({
      data: {
        username,
        email,
        phone,
        password: hashedPassword,
        role: normalizedRole,
        isVerified: true,
      },
    });
    await createAuditLog({ req, action: "CREATE_USER", entity: "User", details: { username, email, role: normalizedRole } });
    res.json({ message: `User created successfully with role: ${normalizedRole}.` });
  } catch (err: any) {
    logger.error("createAdminUser error", err);
    if (err?.code === "P2002") {
      const field = err?.meta?.target?.includes("email") ? "email address" : "phone number";
      return res.status(400).json({ Error: `An account with this ${field} already exists.` });
    }
    res
      .status(500)
      .json({ message: "Error in creating user", Error: err.message });
  }
};

// PATCH /api/admin/users/:id  (admin)
export const updateUser = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { username, email, phone } = req.body as {
      username?: string;
      email?: string;
      phone?: string;
    };

    const existing = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true },
    });
    if (!existing) return res.status(404).json({ message: "User not found." });
    if (existing.role === "SUPER_ADMIN") {
      return res.status(403).json({ message: "Cannot modify a Super Admin account." });
    }

    // Check uniqueness conflicts
    if (email || phone) {
      const orConditions: object[] = [];
      if (email) orConditions.push({ email });
      if (phone) orConditions.push({ phone });
      const conflict = await prisma.user.findFirst({
        where: { AND: [{ id: { not: id } }, { OR: orConditions }] },
        select: { id: true },
      });
      if (conflict) {
        return res.status(400).json({ message: "Email or phone already in use by another account." });
      }
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        ...(username !== undefined && { username }),
        ...(email !== undefined && { email }),
        ...(phone !== undefined && { phone }),
      },
      select: { id: true, username: true, email: true, phone: true, role: true },
    });

    return res.json({ message: "User updated successfully.", user: updated });
  } catch (err: any) {
    logger.error("updateUser error", err);
    return res.status(500).json({ message: "Error updating user." });
  }
};

// DELETE /api/admin/users/:id  (admin)
export const deleteUser = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true },
    });
    if (!target) return res.status(404).json({ message: "User not found." });
    if (target.role === "SUPER_ADMIN") {
      return res.status(403).json({ message: "Cannot delete a Super Admin account." });
    }
    if (req.user?.id === id) {
      return res.status(400).json({ message: "You cannot delete your own account." });
    }

    await prisma.user.delete({ where: { id } });
    await createAuditLog({ req, action: "DELETE_USER", entity: "User", entityId: id, details: { role: target.role } });
    return res.json({ message: "User deleted successfully." });
  } catch (err: any) {
    logger.error("deleteUser error", err);
    return res.status(500).json({ message: "Error deleting user." });
  }
};
