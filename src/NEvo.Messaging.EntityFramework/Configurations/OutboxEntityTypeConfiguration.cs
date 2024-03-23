using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NEvo.Messaging.EntityFramework.Models;

namespace NEvo.Messaging.EntityFramework.Configurations;

public class OutboxEntityTypeConfiguration : IEntityTypeConfiguration<OutboxMessage>
{
    private string _schema;

    public OutboxEntityTypeConfiguration()
    {
        _schema = "nEvo";
    }

    public void Configure(EntityTypeBuilder<OutboxMessage> builder)
    {
        builder.ToTable("OutboxMessages", _schema);
        builder.HasKey(x => x.MessageId).IsClustered(false);
        builder.Property(x => x.Order).ValueGeneratedOnAdd();
        builder.HasIndex(x => new { x.Status, x.Partition, x.Order }).IsClustered();
        builder.HasIndex(x => new { x.Status, x.Order });
        builder.Property(x => x.Payload).HasMaxLength(int.MaxValue).IsRequired();
        builder.Property(x => x.MessageType).HasMaxLength(255).IsRequired();
        builder.Property(x => x.Headers).HasMaxLength(1024).IsRequired();
    }
}
