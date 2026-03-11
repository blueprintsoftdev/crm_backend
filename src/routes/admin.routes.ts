import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { adminMiddleware } from "../middleware/admin.middleware";
import { featureGate } from "../middleware/featureGate.middleware";
import { profileData, updateAvatar, deleteAvatar } from "../controllers/profileAdmin.controller";
import {
  requestProfileUpdate,
  verifyAndUpdateProfile,
} from "../controllers/updateProfile.controller";
import {
  getAdminSummary,
  getDashboardData,
  getAllUsers,
  createAdminUser,
  updateUser,
  deleteUser,
} from "../controllers/admin.controller";
import { validate } from "../middleware/validate.middleware";
import { createUserSchema } from "../schemas/user.schema";
import { getCompanySettings, updateCompanySettings, getHomepageConfig, updateHeroConfig, updateFooterConfig, uploadAdminImage } from "../controllers/companySettings.controller";
import upload from "../middleware/upload";
import {
  getTrackedCustomers,
  getCustomerWishlist,
  getCustomerCart,
} from "../controllers/customerTracker.controller";

const router = Router();

// Users management — gated by USER_MANAGEMENT feature flag
router.get("/users", authMiddleware, adminMiddleware, featureGate("USER_MANAGEMENT"), getAllUsers);
router.post("/users", authMiddleware, adminMiddleware, featureGate("USER_MANAGEMENT"), validate(createUserSchema), createAdminUser);
router.patch("/users/:id", authMiddleware, adminMiddleware, featureGate("USER_MANAGEMENT"), updateUser);
router.delete("/users/:id", authMiddleware, adminMiddleware, featureGate("USER_MANAGEMENT"), deleteUser);

// Admin profile — never gated (admin always needs profile access)
router.get("/adminProfile", authMiddleware, adminMiddleware, profileData);
router.patch("/avatar", authMiddleware, adminMiddleware, upload.single("avatar"), updateAvatar);
router.delete("/avatar", authMiddleware, adminMiddleware, deleteAvatar);
router.post(
  "/adminProfile/request-update",
  authMiddleware,
  adminMiddleware,
  requestProfileUpdate,
);
router.post(
  "/adminProfile/verify-update",
  authMiddleware,
  adminMiddleware,
  verifyAndUpdateProfile,
);

// Dashboard summary — gated by REPORTS_ANALYTICS feature flag
router.get("/summary", authMiddleware, adminMiddleware, featureGate("REPORTS_ANALYTICS"), getAdminSummary);

// Dashboard live snapshot — no feature gate (always accessible to admin/super-admin)
router.get("/dashboard", authMiddleware, adminMiddleware, getDashboardData);

// Company settings — GET is public (invoice pages), PUT requires admin
router.get("/company-settings", getCompanySettings);
router.put("/company-settings", authMiddleware, adminMiddleware, upload.fields([{ name: "logo", maxCount: 1 }, { name: "favicon", maxCount: 1 }]), updateCompanySettings);

// Single-image upload utility (hero images, etc.)
router.post("/upload-image", authMiddleware, adminMiddleware, upload.single("image"), uploadAdminImage);

// Homepage config (hero + footer templates)
router.get("/homepage-config", authMiddleware, adminMiddleware, getHomepageConfig);
router.put("/homepage-config/hero", authMiddleware, adminMiddleware, updateHeroConfig);
router.put("/homepage-config/footer", authMiddleware, adminMiddleware, updateFooterConfig);

// Customer Activity Tracker — admin+superadmin, gated by CUSTOMER_ACTIVITY_TRACKER feature
router.get("/tracker/customers", authMiddleware, adminMiddleware, featureGate("CUSTOMER_ACTIVITY_TRACKER"), getTrackedCustomers);
router.get("/tracker/customers/:userId/wishlist", authMiddleware, adminMiddleware, featureGate("CUSTOMER_ACTIVITY_TRACKER"), getCustomerWishlist);
router.get("/tracker/customers/:userId/cart", authMiddleware, adminMiddleware, featureGate("CUSTOMER_ACTIVITY_TRACKER"), getCustomerCart);

export default router;
