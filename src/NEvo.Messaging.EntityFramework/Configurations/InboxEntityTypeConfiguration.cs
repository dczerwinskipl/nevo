using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NEvo.Messaging.EntityFramework.Models;

namespace NEvo.Messaging.EntityFramework.Configurations;

public class InboxEntityTypeConfiguration : IEntityTypeConfiguration<InboxProcessedMessage>, IEntityTypeConfiguration<InboxProcessedHandler>
{
    private string _prefix;

    public InboxEntityTypeConfiguration()
    {
        _prefix = "__Inbox_";
    }
    
    public void Configure(EntityTypeBuilder<InboxProcessedMessage> builder)
    {
        builder.ToTable($"{_prefix}InboxProcessedMessages");
        builder.HasKey(x => x.MessageId).IsClustered(false);
        builder.Property(x => x.ProcessedAt).IsRequired();
        builder.HasIndex(x => x.ProcessedAt).IsClustered();
    }

    public void Configure(EntityTypeBuilder<InboxProcessedHandler> builder)
    {
        builder.ToTable($"{_prefix}InboxProcessedHandlers"); 
        builder.HasKey(x => new { x.MessageId, x.HandlerKey }).IsClustered(false);
        builder.Property(x => x.ProcessedAt).IsRequired();
        builder.HasIndex(x => x.ProcessedAt).IsClustered();
    }
}
