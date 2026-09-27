/**
 * Safe response projections.
 *
 * Every route that returns a company/tenant document must go through one of
 * these helpers. `passwordHash` and `ownerEmail` are never included: they are
 * credentials, not catalog data, and the public booking page only needs the
 * salon identity + payment coordinates.
 */

/** Public-facing salon profile (booking page, catalog endpoints). */
function publicCompany(company) {
  if (!company) return null;
  return {
    _id: company._id,
    name: company.name,
    subdomain: company.subdomain,
    salonType: company.salonType,
    location: company.location,
    upiId: company.upiId || "",
    gstNo: company.gstNo || "",
    language: company.language,
    whatsappEnabled: !!company.whatsappEnabled,
    razorpayKey: company.razorpayKey || "",
    logoUrl: company.logoUrl || "",
  };
}

/**
 * Owner-facing settings view. Same as the public profile plus the contact
 * email, but still never the password hash.
 */
function ownerCompany(company) {
  if (!company) return null;
  return { ...publicCompany(company), ownerEmail: company.ownerEmail };
}

/** Staff projection for the public booking page — no salary/commission/eSSL id. */
function publicStaff(staff) {
  if (!staff) return null;
  return {
    _id: staff._id,
    name: staff.name,
    specialization: staff.specialization,
    photoUrl: staff.photoUrl || "",
  };
}

/** Offer projection for the public booking page — no internal counters. */
function publicOffer(offer) {
  if (!offer) return null;
  return {
    _id: offer._id,
    code: offer.code,
    title: offer.title,
    discountType: offer.discountType,
    discountValue: offer.discountValue,
    minOrderAmount: offer.minOrderAmount,
    maxDiscount: offer.maxDiscount,
    applicableServices: offer.applicableServices || [],
  };
}

module.exports = { publicCompany, ownerCompany, publicStaff, publicOffer };
