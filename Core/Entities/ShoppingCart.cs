using System;

namespace Core.Entities;

public class ShoppingCart
{
    public required string Id { get; set; }
    public List<CartItem> Items { get; set; } = [];
    public int? DeliveryMethodId { get; set; }

    public string? PaymentReference { get; set; }
    
    public AppCoupon? Coupon { get; set; }
}