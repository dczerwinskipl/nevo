using System.Diagnostics.CodeAnalysis;

namespace NEvo.Messaging.CQRS.Events;

[ExcludeFromCodeCoverage]
public record Event : Message
{
    public Event() : base() { }
    public Event(Guid id, DateTime createdAt) : base(id, createdAt) { }
}
