using NEvo.Messaging.EntityFramework.Models;

namespace NEvo.Messaging.EntityFramework.Configurations;

public static class ServiceCollectionExtensions
{
    public static ModelBuilder ApplyInboxConfiguration(this ModelBuilder modelBuilder)
    {
        var configuration = new InboxEntityTypeConfiguration();
        modelBuilder.ApplyConfiguration<InboxProcessedMessage>(configuration);
        modelBuilder.ApplyConfiguration<InboxProcessedHandler>(configuration);
        return modelBuilder;
    }
}
