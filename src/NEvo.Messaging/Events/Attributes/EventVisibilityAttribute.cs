using System.Diagnostics.CodeAnalysis;

namespace NEvo.Messaging.Events.Attributes;

[ExcludeFromCodeCoverage]
[AttributeUsage(AttributeTargets.Class, AllowMultiple = true, Inherited = true)]
public abstract class EventVisibilityAttribute : Attribute
{
    public abstract bool IsPrivate { get; }
}
