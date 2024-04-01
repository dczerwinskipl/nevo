using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace NEvo.ExampleApp.Identity.Api.Database;

public class ExampleAppIdentityDbContext : IdentityDbContext
{
    public ExampleAppIdentityDbContext(DbContextOptions<ExampleAppIdentityDbContext> options)
        : base(options)
    {
    }
}
