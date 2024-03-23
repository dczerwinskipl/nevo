using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NEvo.Messaging.EntityFramework.Models;

namespace NEvo.Messaging.EntityFramework.Configurations;

public class InboxEntityTypeConfiguration : IEntityTypeConfiguration<InboxProcessedMessage>, IEntityTypeConfiguration<InboxProcessedHandler>
{
    private string _schema;

    public InboxEntityTypeConfiguration()
    {
        _schema = "nEvo";
    }
    
    public void Configure(EntityTypeBuilder<InboxProcessedMessage> builder)
    {
        builder.ToTable("InboxProcessedMessages", _schema);
        builder.HasKey(x => x.MessageId).IsClustered(false);
        builder.Property(x => x.ProcessedAt).IsRequired();
        builder.HasIndex(x => x.ProcessedAt).IsClustered();
    }

    public void Configure(EntityTypeBuilder<InboxProcessedHandler> builder)
    {
        builder.ToTable("InboxProcessedHandlers", _schema); 
        builder.HasKey(x => new { x.MessageId, x.HandlerKey }).IsClustered(false);
        builder.Property(x => x.ProcessedAt).IsRequired();
        builder.HasIndex(x => x.ProcessedAt).IsClustered();
    }
}
