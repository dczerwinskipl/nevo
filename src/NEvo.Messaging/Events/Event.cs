using System.Diagnostics.CodeAnalysis;

namespace NEvo.Messaging.Cqrs.Events;

[ExcludeFromCodeCoverage]
public record Event : Message
{
    public Event() : base() { }
    public Event(Guid id, DateTime createdAt) : base(id, createdAt) { }
}
