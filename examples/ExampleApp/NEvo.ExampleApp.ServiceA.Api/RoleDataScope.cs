using System.ComponentModel.DataAnnotations;
using NEvo.Authorization;

namespace NEvo.ExampleApp.ServiceA.Api;

// TODO: Move to shared kernel
public record RoleDataScope : AuthDataScope
{
    [Required]
    public required string TenantId { get; set; }

    [Required]
    public required string CompanyId { get; set; }
}