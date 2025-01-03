﻿using LanguageExt;
using NEvo.Messaging.EntityFramework.Models;
using NEvo.Messaging.Transporting;

namespace NEvo.Messaging.EntityFramework;

public class EntityFrameworkMessageOutbox(IOutboxDbContext dbContext) : IMessageOutbox
{
    public IAsyncEnumerable<MessageEnvelopeDto> GetMessagesToPublishAsync(int cnt, int? partition)
    {
        var query = dbContext.OutboxMessages.Where(m => m.Status == OutboxMessage.OutboxMessageStatus.Created);
        if (partition.HasValue)
        {
            query = query
                        .Where(m => m.Partition == partition.Value)
                        .OrderBy(m => m.Status)
                        .OrderBy(m => m.Partition)
                        .ThenBy(m => m.Order);
        }
        else
        {
            query = query
                        .OrderBy(m => m.Status)
                        .OrderBy(m => m.Order);
        }

        //TODO: locking
        return query
                .Take(cnt)
                .Select(m => new MessageEnvelopeDto(m.MessageId, m.MessageType, m.Payload, new Context.MessageContextHeaders() /* ToDo - serialize? */, m.PartitionKey))
                .AsAsyncEnumerable();
    }

    public async Task<Unit> SaveMessageAsync(MessageEnvelopeDto message)
    {
        //TODO partitioning
        await dbContext.AddAsync(new OutboxMessage(message.MessageId, message.Payload, message.MessageType, string.Empty /* ToDo - serialize? */, message.PartitionKey, 0));
        await dbContext.SaveChangesAsync();
        return Unit.Default;
    }
}